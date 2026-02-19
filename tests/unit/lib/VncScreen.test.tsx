import { createRef } from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { VncScreenHandle } from '../../../src/lib/VncScreen';

type MockFn = ReturnType<typeof mock>;
type MockRfbInstance = {
    blur: MockFn;
    focus: MockFn;
    disconnect: MockFn;
    approveServer: MockFn;
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

describe('VncScreen', () => {
    beforeEach(() => {
        mockRfbInstances.length = 0;
    });

    it('blurs on default mouse leave behavior', async () => {
        const { container } = render(<VncScreen url="ws://example.com" />);
        const screen = getScreenDiv(container);
        const rfb = await getLastRfb();

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
        const rfb = await getLastRfb();

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
        const rfb = await getLastRfb();

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
        const rfb = await getLastRfb();

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
        const rfb = await getLastRfb();

        ref.current?.rejectServer();
        expect(rfb.disconnect).toHaveBeenCalledTimes(1);
    });

    it('reconnect retry does not disconnect stale RFB instances', async () => {
        render(<VncScreen url="ws://example.com" retryDuration={50} />);
        const firstRfb = await getLastRfb();

        firstRfb.dispatchEvent(new CustomEvent('disconnect', {
            detail: { clean: false },
        }));

        await waitFor(() => {
            expect(mockRfbInstances.length).toBe(2);
        }, { timeout: 1_000 });
        expect(firstRfb.disconnect).not.toHaveBeenCalled();
    });
});
