import { expect, test, type Page } from '@playwright/test';

const getConsoleBuffer = (page: Page) => {
    const messages: string[] = [];
    page.on('console', (msg) => {
        messages.push(`[${msg.type()}] ${msg.text()}`);
    });
    return messages;
};

const getSentWebSocketFrames = (page: Page) => {
    const frames: string[] = [];
    page.on('websocket', (socket) => {
        socket.on('framesent', (event: { payload: string | Buffer }) => {
            const payload = event.payload;
            frames.push(typeof payload === 'string' ? payload : payload.toString('utf-8'));
        });
    });
    return frames;
};

test('connects to a real dockerized VNC websocket endpoint', async ({ page }) => {
    const logs = getConsoleBuffer(page);
    await page.goto('/');

    await page.getByPlaceholder('wss://your-vnc-url').fill('ws://127.0.0.1:6080');
    await page.getByRole('button', { name: 'Go!' }).click();

    await expect
        .poll(
            async () => {
                const hasConnectedLog = logs.some((entry) => entry.includes('Connected to remote VNC.'));
                const canvasCount = await page.locator('canvas').count();
                return hasConnectedLog && canvasCount > 0;
            },
            {
                timeout: 60_000,
                message: 'expected dockerized VNC endpoint to connect and render canvas',
            },
        )
        .toBe(true);

    const canvas = page.locator('canvas');
    await expect(canvas.first()).toBeVisible();

    const box = await canvas.first().boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(100);
    expect(box!.height).toBeGreaterThan(100);

    const combined = logs.join('\n');
    expect(combined).toContain('Connected to remote VNC.');
    expect(combined).not.toContain('Authentication failed');
});

test('sends clipboard text over the active noVNC websocket session', async ({ page }) => {
    const sentFrames = getSentWebSocketFrames(page);
    await page.goto('/');

    await page.getByPlaceholder('wss://your-vnc-url').fill('ws://127.0.0.1:6080');
    await page.getByRole('button', { name: 'Go!' }).click();
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 });

    const token = `clipboard-token-${Date.now()}`;
    await page.getByTestId('clipboard-input').fill(token);
    await page.getByTestId('clipboard-send').click();

    await expect
        .poll(() => sentFrames.some((frame) => frame.includes(token)), {
            timeout: 15_000,
            message: 'expected clipboard text to be sent on the noVNC websocket transport',
        })
        .toBe(true);
});

test('interacts with the VNC server visually (agent typing and mouse movement)', async ({ page }) => {
    // This test is particularly designed for the user to watch the agent in headed/ui mode
    await page.goto('/');

    await page.getByPlaceholder('wss://your-vnc-url').fill('ws://127.0.0.1:6080');
    await page.getByRole('button', { name: 'Go!' }).click();

    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 60_000 });

    // Wait a brief moment for the VNC display (Fluxbox + xterm) to actually paint
    await page.waitForTimeout(2000);

    // Get the canvas bounding box to perform precise clicks
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();

    // 1. Move the mouse to the center and click to focus the xterm window
    // (We started xterm at 10x10 so clicking around x=100, y=100 is safe)
    await page.mouse.move(box!.x + 100, box!.y + 100);
    await page.mouse.down();
    await page.mouse.up();

    // Wait to ensure window is focused
    await page.waitForTimeout(500);

    // 2. Type some commands to visually prove interactivity!
    // We'll echo something and launch xeyes.
    const command = 'echo "Hello from Playwright Agent!" && xeyes &';
    for (const char of command) {
        await page.keyboard.press(char);
        await page.waitForTimeout(50); // small delay to mimic human typing
    }
    await page.keyboard.press('Enter');

    // Wait a couple seconds to see xeyes open
    await page.waitForTimeout(2000);

    // 3. Move the mouse around to watch xeyes follow the cursor!
    for (let i = 0; i < 5; i++) {
        await page.mouse.move(box!.x + 150, box!.y + 150, { steps: 10 });
        await page.waitForTimeout(200);
        await page.mouse.move(box!.x + 400, box!.y + 300, { steps: 10 });
        await page.waitForTimeout(200);
    }

    // 4. Test Clipboard pasting
    const clipboardText = 'cat /etc/os-release';
    await page.getByTestId('clipboard-input').fill(clipboardText);
    await page.getByTestId('clipboard-send').click();

    // Since we just sent to remote clipboard, we'll try pasting it in the terminal
    // Fluxbox xterm: Middle-click usually pastes.
    // Or we can just type 'Shift+Insert' depending on terminal settings.
    await page.waitForTimeout(500);
    await page.mouse.move(box!.x + 100, box!.y + 200);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.up({ button: 'middle' });
    
    // Press enter to run the pasted command
    await page.waitForTimeout(1000);
    await page.keyboard.press('Enter');

    // Give it a final visual pause before closing
    await page.waitForTimeout(3000);
});

test('does not hit disconnected-RFB reconnect regression on failed websocket endpoint', async ({ page }) => {
    const logs = getConsoleBuffer(page);
    await page.goto('/');

    await page.getByPlaceholder('wss://your-vnc-url').fill('ws://127.0.0.1:6099');
    await page.getByRole('button', { name: 'Go!' }).click();

    await page.waitForTimeout(6500);

    const combined = logs.join('\n');
    expect(combined).toContain('Failed when connecting');
    expect(combined).not.toContain('Tried changing state of a disconnected RFB object');
});

test('connects after hot-swapping URL from invalid endpoint to a valid endpoint', async ({ page }) => {
    const logs = getConsoleBuffer(page);
    await page.goto('/');

    await page.getByPlaceholder('wss://your-vnc-url').fill('ws://127.0.0.1:6099');
    await page.getByRole('button', { name: 'Go!' }).click();
    await page.waitForTimeout(1500);

    await page.getByPlaceholder('wss://your-vnc-url').fill('ws://127.0.0.1:6080');
    await page.getByRole('button', { name: 'Go!' }).click();

    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 });

    const combined = logs.join('\n');
    expect(combined).toContain('Connected to remote VNC.');
});
