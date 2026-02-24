import { createRef } from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { VncScreenHandle } from '../../../src/lib/VncScreen';

type MockFn = ReturnType<typeof mock>;
type MockRfbInstance = {
    blur: MockFn;
    focus: MockFn;
    disconnect: MockFn;
    approveServer: MockFn;
    sendCredentials: MockFn;
    urlOrChannel: string | WebSocket;
    dispatchEvent: (event: Event) => boolean;
};

const mockRfbInstances: MockRfbInstance[] = [];

mock.module('@novnc/novnc', () => {
    class MockRFB extends EventTarget {
        viewOnly = false;
        focusOnClick = false;
        clipViewport = false;
        dragViewport = false;
        resizeSession = false;
        scaleViewport = false;
        showDotCursor = false;
        background = '';
        qualityLevel = 6;
        compressionLevel = 2;

        disconnect = mock(() => {});
        sendCredentials = mock(() => {});
        sendKey = mock(() => {});
        sendCtrlAltDel = mock(() => {});
        focus = mock(() => {});
        blur = mock(() => {});
        machineShutdown = mock(() => {});
        machineReboot = mock(() => {});
        machineReset = mock(() => {});
        clipboardPasteFrom = mock(() => {});
        approveServer = mock(() => {});

        constructor(
            public target: Element,
            public urlOrChannel: string | WebSocket,
            public options?: unknown,
        ) {
            super();
            mockRfbInstances.push(this as unknown as MockRfbInstance);
        }
    }

    return { default: MockRFB };
});

const { default: VncScreen } = await import('../../../src/lib/VncScreen');

const getLastRfb = async (): Promise<MockRfbInstance> => {
    const rfb = mockRfbInstances[mockRfbInstances.length - 1];
    if (!rfb) {
        throw new Error('Expected a mocked RFB instance');
    }
    return rfb;
};

const waitForFirstRfb = async (): Promise<MockRfbInstance> => {
    await waitFor(() => {
        expect(mockRfbInstances.length).toBeGreaterThan(0);
    }, { timeout: 1_000 });
    return getLastRfb();
};

const getScreenDiv = (container: HTMLElement): HTMLDivElement => {
    const maybeScreen = container.firstElementChild;
    if (!(maybeScreen instanceof HTMLDivElement)) {
        throw new Error('Expected VncScreen to render a div root');
    }
    return maybeScreen;
};

const dispatchMouseOut = (element: Element, relatedTarget: EventTarget | null) => {
    const event = new MouseEvent('mouseout', { bubbles: true });
    Object.defineProperty(event, 'relatedTarget', { value: relatedTarget });
    element.dispatchEvent(event);
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('VncScreen', () => {
    beforeEach(() => {
        mockRfbInstances.length = 0;
    });

    afterEach(() => {
        cleanup();
    });

    it('blurs on default mouse leave behavior', async () => {
        const { container } = render(<VncScreen url="ws://example.com" />);
        const screen = getScreenDiv(container);
        const rfb = await waitForFirstRfb();

        dispatchMouseOut(screen, document.createElement('div'));
        expect(rfb.blur).toHaveBeenCalledTimes(1);
    });

    it('lets consumer override child mouse leave behavior', async () => {
        const onChildMouseLeave = mock(() => {});
        const { container } = render(
            <VncScreen
                url="ws://example.com"
                onChildMouseLeave={onChildMouseLeave}
            />,
        );
        const screen = getScreenDiv(container);
        const rfb = await waitForFirstRfb();

        fireEvent.mouseLeave(screen);
        expect(onChildMouseLeave).toHaveBeenCalledTimes(1);
        expect(rfb.blur).not.toHaveBeenCalled();
    });

    it('provides server verification context and allows manual approve', async () => {
        const onServerVerification = mock((_: unknown, context: { approve: () => void }) => {
            context.approve();
        });
        render(
            <VncScreen
                url="ws://example.com"
                onServerVerification={onServerVerification}
            />,
        );
        const rfb = await waitForFirstRfb();

        rfb.dispatchEvent(new CustomEvent('serververification', {
            detail: {
                type: 'TEST',
            },
        }));

        await waitFor(() => {
            expect(onServerVerification).toHaveBeenCalledTimes(1);
        });
        expect(rfb.approveServer).toHaveBeenCalledTimes(1);
    });

    it('can auto-approve server verification when explicitly enabled', async () => {
        render(
            <VncScreen
                url="ws://example.com"
                autoApproveServerVerification
            />,
        );
        const rfb = await waitForFirstRfb();

        rfb.dispatchEvent(new CustomEvent('serververification', {
            detail: {
                type: 'TEST',
            },
        }));

        await waitFor(() => {
            expect(rfb.approveServer).toHaveBeenCalledTimes(1);
        });
    });

    it('exposes rejectServer via ref and disconnects current session', async () => {
        const ref = createRef<VncScreenHandle>();
        render(<VncScreen ref={ref} url="ws://example.com" />);
        const rfb = await waitForFirstRfb();

        ref.current?.rejectServer();
        expect(rfb.disconnect).toHaveBeenCalledTimes(1);
    });

    it('does not disconnect before first manual connect', async () => {
        const ref = createRef<VncScreenHandle>();
        render(<VncScreen ref={ref} url="ws://example.com" autoConnect={false} />);

        expect(mockRfbInstances.length).toBe(0);
        ref.current?.connect();

        await waitFor(() => {
            expect(mockRfbInstances.length).toBe(1);
        });

        const rfb = await getLastRfb();
        expect(rfb.disconnect).not.toHaveBeenCalled();
    });

    it('connects when url transitions from undefined to defined', async () => {
        const { rerender } = render(<VncScreen autoConnect />);
        expect(mockRfbInstances.length).toBe(0);

        rerender(<VncScreen autoConnect url="ws://example.com" />);

        await waitFor(() => {
            expect(mockRfbInstances.length).toBe(1);
        });
    });

    it('reconnects when URL prop changes', async () => {
        const { rerender } = render(<VncScreen url="ws://example.com" />);
        const firstRfb = await waitForFirstRfb();

        rerender(<VncScreen url="ws://example-2.com" />);

        await waitFor(() => {
            expect(mockRfbInstances.length).toBe(2);
        }, { timeout: 1_000 });

        const secondRfb = await getLastRfb();
        expect(firstRfb.disconnect).toHaveBeenCalledTimes(1);
        expect(secondRfb.urlOrChannel).toBe('ws://example-2.com');
    });

    it('uses latest callback props without forcing reconnect', async () => {
        const onClipboardV1 = mock(() => {});
        const { rerender } = render(
            <VncScreen
                url="ws://example.com"
                onClipboard={onClipboardV1}
            />,
        );
        const rfb = await waitForFirstRfb();

        rfb.dispatchEvent(new CustomEvent('clipboard', {
            detail: { text: 'first' },
        }));
        expect(onClipboardV1).toHaveBeenCalledTimes(1);

        const onClipboardV2 = mock(() => {});
        rerender(
            <VncScreen
                url="ws://example.com"
                onClipboard={onClipboardV2}
            />,
        );

        expect(mockRfbInstances.length).toBe(1);

        rfb.dispatchEvent(new CustomEvent('clipboard', {
            detail: { text: 'second' },
        }));

        expect(onClipboardV1).toHaveBeenCalledTimes(1);
        expect(onClipboardV2).toHaveBeenCalledTimes(1);
    });

    it('retries on unclean disconnect even when consumer provides onDisconnect callback', async () => {
        const onDisconnect = mock(() => {});
        render(
            <VncScreen
                url="ws://example.com"
                onDisconnect={onDisconnect}
                retryDuration={50}
            />,
        );
        const firstRfb = await waitForFirstRfb();

        firstRfb.dispatchEvent(new CustomEvent('disconnect', {
            detail: { clean: false },
        }));

        await waitFor(() => {
            expect(mockRfbInstances.length).toBe(2);
        }, { timeout: 1_000 });

        expect(onDisconnect).toHaveBeenCalledTimes(1);
    });

    it('does not retry on clean disconnect events', async () => {
        render(<VncScreen url="ws://example.com" retryDuration={50} />);
        const firstRfb = await waitForFirstRfb();

        firstRfb.dispatchEvent(new CustomEvent('disconnect', {
            detail: { clean: true },
        }));

        await sleep(150);
        expect(mockRfbInstances.length).toBe(1);
    });

    it('stops retrying when maxRetries is reached', async () => {
        render(
            <VncScreen
                url="ws://example.com"
                retryDuration={30}
                maxRetries={1}
            />,
        );

        const firstRfb = await waitForFirstRfb();
        firstRfb.dispatchEvent(new CustomEvent('disconnect', {
            detail: { clean: false },
        }));

        await waitFor(() => {
            expect(mockRfbInstances.length).toBe(2);
        }, { timeout: 1_000 });

        const secondRfb = await waitForFirstRfb();
        secondRfb.dispatchEvent(new CustomEvent('disconnect', {
            detail: { clean: false },
        }));

        await sleep(150);
        expect(mockRfbInstances.length).toBe(2);
    });

    it('reconnect retry does not disconnect stale RFB instances', async () => {
        render(<VncScreen url="ws://example.com" retryDuration={50} />);
        const firstRfb = await waitForFirstRfb();

        firstRfb.dispatchEvent(new CustomEvent('disconnect', {
            detail: { clean: false },
        }));

        await waitFor(() => {
            expect(mockRfbInstances.length).toBe(2);
        }, { timeout: 1_000 });
        expect(firstRfb.disconnect).not.toHaveBeenCalled();
    });
});
