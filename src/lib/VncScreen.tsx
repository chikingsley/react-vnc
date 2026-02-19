import React, {
    forwardRef,
    MouseEventHandler,
    useEffect,
    useImperativeHandle,
    useRef,
    useState,
} from 'react';
import RFB from '@novnc/novnc';
import type { NoVncEventType, NoVncEvents, NoVncOptions } from '@novnc/novnc/lib/rfb';

type EventListeners = { [T in NoVncEventType]?: (event: NoVncEvents[T]) => void };

export type ServerVerificationInfo = {
    type: string;
    publickey?: Uint8Array;
    fingerprint?: string;
    receivedAt: string;
};

export type ServerVerificationContext = {
    rfb: NoVncRfb | null;
    info: ServerVerificationInfo;
    approve: () => void;
    reject: () => void;
};

type NoVncRfb = import('@novnc/novnc/lib/rfb').default;

export interface Props {
    url?: string;
    websocket?: WebSocket;
    style?: object;
    className?: string;
    viewOnly?: boolean;
    rfbOptions?: Partial<NoVncOptions>;
    focusOnClick?: boolean;
    clipViewport?: boolean;
    dragViewport?: boolean;
    scaleViewport?: boolean;
    resizeSession?: boolean;
    showDotCursor?: boolean;
    background?: string;
    qualityLevel?: number;
    compressionLevel?: number;
    autoConnect?: boolean;
    retryDuration?: number;
    debug?: boolean;
    onConnect?: EventListeners['connect'];
    onDisconnect?: EventListeners['disconnect'];
    onCredentialsRequired?: EventListeners['credentialsrequired'];
    onServerVerification?: (
        event: NoVncEvents['serververification'],
        context: ServerVerificationContext,
    ) => void;
    onSecurityFailure?: EventListeners['securityfailure'];
    onClipboard?: EventListeners['clipboard'];
    onBell?: EventListeners['bell'];
    onDesktopName?: EventListeners['desktopname'];
    onCapabilities?: EventListeners['capabilities'];
    onClippingViewport?: EventListeners['clippingviewport'];
    autoApproveServerVerification?: boolean;
    onChildMouseLeave?: MouseEventHandler<HTMLDivElement>;
    onChildMouseEnter?: MouseEventHandler<HTMLDivElement>;
}

export type VncScreenHandle = {
    connect: () => void;
    disconnect: () => void;
    connected: boolean;
    sendCredentials: (credentials: NoVncOptions["credentials"]) => void;
    sendKey: (keysym: number, code: string, down?: boolean) => void;
    sendCtrlAltDel: () => void;
    focus: () => void;
    blur: () => void;
    machineShutdown: () => void;
    machineReboot: () => void;
    machineReset: () => void;
    approveServer: () => void;
    rejectServer: () => void;
    clipboardPaste: (text: string) => void;
    rfb: NoVncRfb | null;
    loading: boolean;
    lastServerVerification: ServerVerificationInfo | null;
    eventListeners: EventListeners;
};

const VncScreen: React.ForwardRefRenderFunction<VncScreenHandle, Props> = (props, ref) => {
    const rfb = useRef<NoVncRfb | null>(null);
    const connected = useRef<boolean>(props.autoConnect ?? true);
    const timeouts = useRef<Array<NodeJS.Timeout>>([]);
    const eventListeners = useRef<EventListeners>({});
    const lastServerVerification = useRef<ServerVerificationInfo | null>(null);
    const screen = useRef<HTMLDivElement>(null);
    const [loading, setLoading] = useState<boolean>(true);

    const {
        url,
        websocket,
        style,
        className,
        viewOnly,
        rfbOptions,
        focusOnClick,
        clipViewport,
        dragViewport,
        scaleViewport,
        resizeSession,
        showDotCursor,
        background,
        qualityLevel,
        compressionLevel,
        autoConnect = true,
        retryDuration = 3000,
        debug = false,
        autoApproveServerVerification = false,
        onChildMouseLeave,
        onChildMouseEnter,
        onConnect,
        onDisconnect,
        onCredentialsRequired,
        onServerVerification,
        onSecurityFailure,
        onClipboard,
        onBell,
        onDesktopName,
        onCapabilities,
        onClippingViewport,
    } = props;

    const logger = {
        log: (...args: any[]) => { if (debug) console.log(...args); },
        info: (...args: any[]) => { if (debug) console.info(...args); },
        error: (...args: any[]) => { if (debug) console.error(...args); },
    };
    type RfbWithApproveServer = NoVncRfb & { approveServer?: () => void };

    const getRfb = () => {
        return rfb.current;
    };

    const setRfb = (_rfb: NoVncRfb | null) => {
        rfb.current = _rfb;
    };

    const getConnected = () => {
        return connected.current;
    };

    const setConnected = (state: boolean) => {
        connected.current = state;
    };

    const _onConnect = (e: NoVncEvents['connect']) => {
        if (onConnect) {
            onConnect(e);
            setLoading(false);
            return;
        }

        logger.info('Connected to remote VNC.');
        setLoading(false);
    };

    const _onDisconnect: EventListeners['disconnect'] = (e) => {
        if (onDisconnect) {
            onDisconnect(e);
            setLoading(true);
            return;
        }

        const connected = getConnected();
        if (connected && !websocket) {
            logger.info(`Unexpectedly disconnected from remote VNC, retrying in ${retryDuration / 1000} seconds.`);

            // The current RFB instance is already disconnected at this point.
            // Clearing it avoids calling disconnect() on a stale RFB during retry.
            setRfb(null);
            timeouts.current.push(setTimeout(connect, retryDuration));
        } else {
            logger.info(`Disconnected from remote VNC.`);
        }
        setLoading(true);
    };

    const _onCredentialsRequired: EventListeners['credentialsrequired'] = (e) => {
        const rfb = getRfb();
        if (onCredentialsRequired) {
            onCredentialsRequired(e);
            return;
        }

        const username = rfbOptions?.credentials?.username ?? '';
        const password = rfbOptions?.credentials?.password ?? '';
        const target = rfbOptions?.credentials?.target ?? '';
        rfb?.sendCredentials({ password, username, target });
    };

    const _onDesktopName: EventListeners['desktopname'] = (e) => {
        if (onDesktopName) {
            onDesktopName(e);
            return;
        }

        logger.info(`Desktop name is ${e.detail.name}`);
    };

    const getServerFingerprint = async (publickey: Uint8Array): Promise<string | undefined> => {
        const subtle = window?.crypto?.subtle;
        if (!subtle) {
            return undefined;
        }

        const digestInput = Uint8Array.from(publickey);
        const digest = await subtle.digest('SHA-1', digestInput);
        return Array.from(new Uint8Array(digest).slice(0, 8))
            .map((x) => x.toString(16).padStart(2, '0'))
            .join('-');
    };

    const disconnect = () => {
        const rfb = getRfb();
        try {
            if (!rfb) {
                return;
            }

            timeouts.current.forEach(clearTimeout);
            (Object.keys(eventListeners.current) as (NoVncEventType)[]).forEach((event) => {
                if (eventListeners.current[event]) {
                    rfb.removeEventListener(event, eventListeners.current[event]!);
                    eventListeners.current[event] = undefined;
                }
            });
            rfb.disconnect();
            setRfb(null);
            setConnected(false);

            // NOTE(roerohan): This needs to be called since the event listener is removed.
            // Even if the event listener is removed after rfb.disconnect(), the disconnect
            // event is not fired.
            _onDisconnect(new CustomEvent('disconnect', { detail: { clean: true } }));
        } catch (err) {
            logger.error(err);
            setRfb(null);
            setConnected(false);
        }
    };

    const approveServer = () => {
        const rfb = getRfb();
        if (!rfb) {
            return;
        }

        const rfbWithApprove = rfb as RfbWithApproveServer;
        rfbWithApprove.approveServer?.();
    };

    const rejectServer = () => {
        disconnect();
    };

    const _onServerVerification = async (event: NoVncEvents['serververification']) => {
        const rfb = getRfb();
        const { detail } = event;
        const fingerprint = detail.type === 'RSA' && detail.publickey
            ? await getServerFingerprint(detail.publickey)
            : undefined;

        const info: ServerVerificationInfo = {
            type: detail.type,
            publickey: detail.publickey,
            fingerprint,
            receivedAt: new Date().toISOString(),
        };
        lastServerVerification.current = info;

        const context: ServerVerificationContext = {
            rfb,
            info,
            approve: approveServer,
            reject: rejectServer,
        };

        if (onServerVerification) {
            onServerVerification(event, context);
            return;
        }

        if (autoApproveServerVerification) {
            logger.info('Auto-approving server verification. Provide onServerVerification for manual verification.');
            approveServer();
            return;
        }

        logger.info(
            'Server verification required. Provide onServerVerification and call context.approve() ' +
            'after validating identity, or set autoApproveServerVerification=true.',
        );
    };

    const connect = () => {
        try {
            if (connected && !!rfb) {
                disconnect();
            }

            if (!screen.current) {
                return;
            }

            if (!url && !websocket) {
                logger.error('Either url or websocket must be provided');
                return;
            }

            screen.current.innerHTML = '';

            const _rfb = new RFB(screen.current, websocket || url!, rfbOptions);

            _rfb.viewOnly = viewOnly ?? false;
            _rfb.focusOnClick = focusOnClick ?? false;
            _rfb.clipViewport = clipViewport ?? false;
            _rfb.dragViewport = dragViewport ?? false;
            _rfb.resizeSession = resizeSession ?? false;
            _rfb.scaleViewport = scaleViewport ?? false;
            _rfb.showDotCursor = showDotCursor ?? false;
            _rfb.background = background ?? '';
            _rfb.qualityLevel = qualityLevel ?? 6;
            _rfb.compressionLevel = compressionLevel ?? 2;
            setRfb(_rfb);

            eventListeners.current.connect = _onConnect;
            eventListeners.current.disconnect = _onDisconnect;
            eventListeners.current.credentialsrequired = _onCredentialsRequired;
            eventListeners.current.securityfailure = onSecurityFailure;
            eventListeners.current.clipboard = onClipboard;
            eventListeners.current.bell = onBell;
            eventListeners.current.desktopname = _onDesktopName;
            eventListeners.current.capabilities = onCapabilities;
            eventListeners.current.clippingviewport = onClippingViewport;
            eventListeners.current.serververification = _onServerVerification;

            (Object.keys(eventListeners.current) as (NoVncEventType)[]).forEach((event) => {
                if (eventListeners.current[event]) {
                    _rfb.addEventListener(event, eventListeners.current[event]!);
                }
            });

            setConnected(true);
        } catch (err) {
            logger.error(err);
        }
    };

    const sendCredentials = (credentials: NoVncOptions["credentials"]) => {
        const rfb = getRfb();
        const creds = {
            username: credentials?.username ?? '',
            password: credentials?.password ?? '',
            target: credentials?.target ?? '',
        }
        rfb?.sendCredentials(creds);
    };

    const sendKey = (keysym: number, code: string, down?: boolean) => {
        const rfb = getRfb();
        rfb?.sendKey(keysym, code, down);
    };

    const sendCtrlAltDel = () => {
        const rfb = getRfb();
        rfb?.sendCtrlAltDel();
    };

    const focus = () => {
        const rfb = getRfb();
        rfb?.focus();
    };

    const blur = () => {
        const rfb = getRfb();
        rfb?.blur();
    };

    const machineShutdown = () => {
        const rfb = getRfb();
        rfb?.machineShutdown();
    };

    const machineReboot = () => {
        const rfb = getRfb();
        rfb?.machineReboot();
    };

    const machineReset = () => {
        const rfb = getRfb();
        rfb?.machineReset();
    };

    const clipboardPaste = (text: string) => {
        const rfb = getRfb();
        rfb?.clipboardPasteFrom(text);
    };

    useImperativeHandle(ref, () => ({
        connect,
        disconnect,
        connected: connected.current,
        sendCredentials,
        sendKey,
        sendCtrlAltDel,
        focus,
        blur,
        machineShutdown,
        machineReboot,
        machineReset,
        approveServer,
        rejectServer,
        clipboardPaste,
        rfb: rfb.current,
        loading,
        lastServerVerification: lastServerVerification.current,
        eventListeners: eventListeners.current,
    }));

    useEffect(() => {
        if (autoConnect) {
            connect();
        }

        return disconnect;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleClick = () => {
        const rfb = getRfb();
        if (!rfb) return;

        rfb.focus();
    };

    const defaultHandleMouseEnter = () => {
        if (document.activeElement && document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
        }

        handleClick();
    };

    const defaultHandleMouseLeave: MouseEventHandler<HTMLDivElement> = (e) => {
        const relatedTarget = e.relatedTarget;
        if (
            relatedTarget &&
            relatedTarget instanceof HTMLElement &&
            relatedTarget.id === 'noVNC_mouse_capture_elem'
        ) {
            return;
        }

        const rfb = getRfb();
        if (!rfb) {
            return;
        }

        rfb.blur();
    };

    return (
        <div
            style={style}
            className={className}
            ref={screen}
            onMouseEnter={onChildMouseEnter ?? defaultHandleMouseEnter}
            onMouseLeave={onChildMouseLeave ?? defaultHandleMouseLeave}
        />
    );
}

export default forwardRef(VncScreen);
