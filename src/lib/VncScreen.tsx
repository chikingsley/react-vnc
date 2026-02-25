import React, {
    MouseEventHandler,
    useCallback,
    useEffect,
    useEffectEvent,
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
type NoVncCredentials = NonNullable<NoVncOptions['credentials']>;

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
    maxRetries?: number;
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
    ref?: React.Ref<VncScreenHandle>;
}

export type VncScreenHandle = {
    connect: () => void;
    disconnect: () => void;
    connected: boolean;
    sendCredentials: (credentials: NoVncCredentials) => void;
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

// Settings applied when creating a new RFB instance. Stored in a ref so
// connect() reads latest values without changing its own identity.
type ConnectionSettings = {
    url?: string;
    websocket?: WebSocket;
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
    debug: boolean;
};

const VncScreen = (props: Props) => {
    const { ref } = props;
    const rfb = useRef<NoVncRfb | null>(null);
    const connected = useRef<boolean>(false);
    const eventListeners = useRef<EventListeners>({});
    const lastServerVerification = useRef<ServerVerificationInfo | null>(null);
    const screen = useRef<HTMLDivElement>(null);
    const [loading, setLoading] = useState<boolean>(true);

    const retryTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
    const retryAttempts = useRef(0);
    const isComponentActive = useRef(true);
    const credentialsMissing = useRef(false);

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
        maxRetries = 10,
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

    const normalizedMaxRetries = Number.isFinite(maxRetries)
        ? Math.max(0, maxRetries)
        : Number.POSITIVE_INFINITY;

    // Settings ref — connect() reads latest values without adding deps that
    // would change its identity and trigger unnecessary reconnections.
    const settingsRef = useRef<ConnectionSettings>({
        url, websocket, viewOnly, rfbOptions, focusOnClick, clipViewport,
        dragViewport, scaleViewport, resizeSession, showDotCursor,
        background, qualityLevel, compressionLevel, debug,
    });
    useEffect(() => {
        settingsRef.current = {
            url, websocket, viewOnly, rfbOptions, focusOnClick, clipViewport,
            dragViewport, scaleViewport, resizeSession, showDotCursor,
            background, qualityLevel, compressionLevel, debug,
        };
    });

    // Ref for the consumer's onDisconnect callback — used by the imperative
    // disconnect() for the synthetic disconnect event. Effect Events can only
    // be called from within effects, so the imperative path uses this ref.
    const onDisconnectPropRef = useRef(onDisconnect);
    useEffect(() => { onDisconnectPropRef.current = onDisconnect; });

    const info = useCallback((...args: any[]) => {
        if (settingsRef.current.debug) {
            console.info(...args);
        }
    }, []);

    const error = useCallback((...args: any[]) => {
        console.error(...args);
    }, []);

    type RfbWithApproveServer = NoVncRfb & { approveServer?: () => void };

    const getRfb = () => rfb.current;
    const setRfb = (_rfb: NoVncRfb | null) => { rfb.current = _rfb; };
    const getConnected = () => connected.current;
    const setConnected = (state: boolean) => { connected.current = state; };

    const clearRetryTimeout = useCallback(() => {
        if (retryTimeout.current) {
            clearTimeout(retryTimeout.current);
            retryTimeout.current = null;
        }
    }, []);

    const getServerFingerprint = useCallback(async (publickey: Uint8Array): Promise<string | undefined> => {
        const subtle = window?.crypto?.subtle;
        if (!subtle) {
            return undefined;
        }

        const digestInput = Uint8Array.from(publickey);
        const digest = await subtle.digest('SHA-1', digestInput);
        return Array.from(new Uint8Array(digest).slice(0, 8))
            .map((x) => x.toString(16).padStart(2, '0'))
            .join('-');
    }, []);

    const approveServer = useCallback(() => {
        const currentRfb = getRfb();
        if (!currentRfb) {
            return;
        }

        const rfbWithApprove = currentRfb as RfbWithApproveServer;
        rfbWithApprove.approveServer?.();
    }, []);

    // --- disconnect (defined before connect so connect can depend on it) ---

    const disconnect = useCallback(() => {
        clearRetryTimeout();

        const currentRfb = getRfb();
        if (!currentRfb) {
            setConnected(false);
            return;
        }

        try {
            (Object.keys(eventListeners.current) as (NoVncEventType)[]).forEach((eventName) => {
                if (eventListeners.current[eventName]) {
                    currentRfb.removeEventListener(eventName, eventListeners.current[eventName]!);
                    eventListeners.current[eventName] = undefined;
                }
            });

            currentRfb.disconnect();
            setRfb(null);
            setConnected(false);
            retryAttempts.current = 0;

            // NOTE(roerohan): This needs to be called since the event listener
            // is removed. Even if the event listener is removed after
            // rfb.disconnect(), the disconnect event is not fired.
            // Uses prop ref instead of Effect Event (imperative context).
            onDisconnectPropRef.current?.(new CustomEvent('disconnect', { detail: { clean: true } }));
            setLoading(true);
        } catch (err) {
            error(err);
            setRfb(null);
            setConnected(false);
        }
    }, [clearRetryTimeout, error]);

    const rejectServer = useCallback(() => {
        disconnect();
    }, [disconnect]);

    // --- Effect Event handlers ---
    // These always read latest callback props from the closure without
    // appearing in any dependency array. Called only from RFB event listeners
    // registered inside the connect() effect chain.

    const onVncConnect = useEffectEvent((event: NoVncEvents['connect']) => {
        onConnect?.(event);

        if (!onConnect) {
            info('Connected to remote VNC.');
        }

        retryAttempts.current = 0;
        credentialsMissing.current = false;
        setLoading(false);
    });

    const onVncDisconnect = useEffectEvent((event: NoVncEvents['disconnect']) => {
        onDisconnect?.(event);

        const clean = (event as { detail?: { clean?: boolean } }).detail?.clean === true;
        const hasRetriesRemaining = retryAttempts.current < normalizedMaxRetries;
        const shouldRetry =
            !clean &&
            autoConnect &&
            !websocket &&
            !credentialsMissing.current &&
            hasRetriesRemaining &&
            isComponentActive.current;

        if (shouldRetry) {
            const nextAttempt = retryAttempts.current + 1;
            retryAttempts.current = nextAttempt;

            info(
                `Unexpectedly disconnected from remote VNC, retrying in ${retryDuration / 1000} seconds ` +
                `(attempt ${nextAttempt}/${normalizedMaxRetries}).`,
            );

            setRfb(null);
            clearRetryTimeout();
            retryTimeout.current = setTimeout(() => {
                if (!isComponentActive.current) {
                    return;
                }

                connect();
            }, retryDuration);
        } else if (!clean && autoConnect && !websocket && !hasRetriesRemaining) {
            info(`Disconnected from remote VNC. Max retries reached (${normalizedMaxRetries}).`);
        } else {
            info('Disconnected from remote VNC.');
        }

        setLoading(true);
    });

    const onVncCredentialsRequired = useEffectEvent((event: NoVncEvents['credentialsrequired']) => {
        const currentRfb = getRfb();

        if (onCredentialsRequired) {
            onCredentialsRequired(event);
            return;
        }

        const requestedTypes = (event as { detail?: { types?: string[] } }).detail?.types ?? [];
        const credentials = rfbOptions?.credentials;

        if (!credentials) {
            credentialsMissing.current = true;
            error('VNC credentials were requested but no credentials are configured.');
            return;
        }

        if (requestedTypes.length === 0) {
            credentialsMissing.current = false;
            const fallbackCredentials: NoVncCredentials = {
                username: credentials.username ?? '',
                password: credentials.password ?? '',
                target: credentials.target ?? '',
            };
            currentRfb?.sendCredentials(fallbackCredentials);
            return;
        }

        const nextCredentials: NoVncCredentials = {
            username: '',
            password: '',
            target: '',
        };
        const missingRequired: string[] = [];

        for (const type of requestedTypes) {
            if (type === 'username') {
                if (credentials.username) {
                    nextCredentials.username = credentials.username;
                } else {
                    missingRequired.push(type);
                }
            }

            if (type === 'password') {
                if (credentials.password) {
                    nextCredentials.password = credentials.password;
                } else {
                    missingRequired.push(type);
                }
            }

            if (type === 'target') {
                if (credentials.target) {
                    nextCredentials.target = credentials.target;
                } else {
                    missingRequired.push(type);
                }
            }
        }

        if (missingRequired.length > 0) {
            credentialsMissing.current = true;
            error(`Missing requested VNC credentials: ${missingRequired.join(', ')}`);
            return;
        }

        credentialsMissing.current = false;
        currentRfb?.sendCredentials(nextCredentials);
    });

    const onVncDesktopName = useEffectEvent((event: NoVncEvents['desktopname']) => {
        onDesktopName?.(event);

        if (!onDesktopName) {
            info(`Desktop name is ${event.detail.name}`);
        }
    });

    const onVncSecurityFailure = useEffectEvent((event: NoVncEvents['securityfailure']) => {
        onSecurityFailure?.(event);
    });

    const onVncClipboard = useEffectEvent((event: NoVncEvents['clipboard']) => {
        onClipboard?.(event);
    });

    const onVncBell = useEffectEvent((event: NoVncEvents['bell']) => {
        onBell?.(event);
    });

    const onVncCapabilities = useEffectEvent((event: NoVncEvents['capabilities']) => {
        onCapabilities?.(event);
    });

    const onVncClippingViewport = useEffectEvent((event: NoVncEvents['clippingviewport']) => {
        onClippingViewport?.(event);
    });

    const onVncServerVerification = useEffectEvent(async (event: NoVncEvents['serververification']) => {
        const currentRfb = getRfb();
        const { detail } = event;
        const fingerprint = detail.type === 'RSA' && detail.publickey
            ? await getServerFingerprint(detail.publickey)
            : undefined;

        const serverInfo: ServerVerificationInfo = {
            type: detail.type,
            publickey: detail.publickey,
            fingerprint,
            receivedAt: new Date().toISOString(),
        };
        lastServerVerification.current = serverInfo;

        const context: ServerVerificationContext = {
            rfb: currentRfb,
            info: serverInfo,
            approve: approveServer,
            reject: rejectServer,
        };

        if (onServerVerification) {
            onServerVerification(event, context);
            return;
        }

        if (autoApproveServerVerification) {
            info('Auto-approving server verification. Provide onServerVerification for manual verification.');
            approveServer();
            return;
        }

        info(
            'Server verification required. Provide onServerVerification and call context.approve() ' +
            'after validating identity, or set autoApproveServerVerification=true.',
        );
    });

    // --- connect ---
    // Reads connection settings from settingsRef (latest values without
    // identity changes). Registers event listeners as arrow wrappers around
    // Effect Events — the wrappers call the latest callback on every event.

    const connect = useCallback(() => {
        try {
            if (getConnected() && getRfb()) {
                disconnect();
            }

            if (!screen.current) {
                return;
            }

            const s = settingsRef.current;
            if (!s.url && !s.websocket) {
                error('Either url or websocket must be provided');
                setConnected(false);
                return;
            }

            credentialsMissing.current = false;
            clearRetryTimeout();
            screen.current.replaceChildren();

            const currentRfb = new RFB(screen.current, s.websocket || s.url!, s.rfbOptions);

            currentRfb.viewOnly = s.viewOnly ?? false;
            currentRfb.focusOnClick = s.focusOnClick ?? true;
            currentRfb.clipViewport = s.clipViewport ?? false;
            currentRfb.dragViewport = s.dragViewport ?? false;
            currentRfb.resizeSession = s.resizeSession ?? false;
            currentRfb.scaleViewport = s.scaleViewport ?? false;
            currentRfb.showDotCursor = s.showDotCursor ?? false;
            currentRfb.background = s.background ?? 'rgb(40, 40, 40)';
            currentRfb.qualityLevel = s.qualityLevel ?? 6;
            currentRfb.compressionLevel = s.compressionLevel ?? 2;
            setRfb(currentRfb);

            // Arrow wrappers around Effect Events — Effect Events must be
            // called from within effect callback chains, not passed directly
            // as listener references (React docs caveat #2).
            const listeners: EventListeners = {
                connect: (e) => onVncConnect(e),
                disconnect: (e) => onVncDisconnect(e),
                credentialsrequired: (e) => onVncCredentialsRequired(e),
                securityfailure: (e) => onVncSecurityFailure(e),
                clipboard: (e) => onVncClipboard(e),
                bell: (e) => onVncBell(e),
                desktopname: (e) => onVncDesktopName(e),
                capabilities: (e) => onVncCapabilities(e),
                clippingviewport: (e) => onVncClippingViewport(e),
                serververification: (e) => onVncServerVerification(e),
            };
            eventListeners.current = listeners;

            (Object.keys(listeners) as (NoVncEventType)[]).forEach((eventName) => {
                if (listeners[eventName]) {
                    currentRfb.addEventListener(eventName, listeners[eventName]!);
                }
            });

            setConnected(true);
        } catch (err) {
            error(err);
            setConnected(false);
        }
    }, [disconnect, clearRetryTimeout, error]);

    const sendCredentials = (credentials: NoVncCredentials) => {
        const currentRfb = getRfb();
        credentialsMissing.current = false;
        const nextCredentials: NoVncCredentials = {
            username: credentials?.username ?? '',
            password: credentials?.password ?? '',
            target: credentials?.target ?? '',
        };
        currentRfb?.sendCredentials(nextCredentials);
    };

    const sendKey = (keysym: number, code: string, down?: boolean) => {
        const currentRfb = getRfb();
        currentRfb?.sendKey(keysym, code, down);
    };

    const sendCtrlAltDel = () => {
        const currentRfb = getRfb();
        currentRfb?.sendCtrlAltDel();
    };

    const focus = () => {
        const currentRfb = getRfb();
        currentRfb?.focus();
    };

    const blur = () => {
        const currentRfb = getRfb();
        currentRfb?.blur();
    };

    const machineShutdown = () => {
        const currentRfb = getRfb();
        currentRfb?.machineShutdown();
    };

    const machineReboot = () => {
        const currentRfb = getRfb();
        currentRfb?.machineReboot();
    };

    const machineReset = () => {
        const currentRfb = getRfb();
        currentRfb?.machineReset();
    };

    const clipboardPaste = (text: string) => {
        const currentRfb = getRfb();
        currentRfb?.clipboardPasteFrom(text);
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
        isComponentActive.current = true;
        let connectTimeout: ReturnType<typeof setTimeout> | null = null;

        if (autoConnect && (url || websocket)) {
            connectTimeout = setTimeout(() => {
                if (isComponentActive.current) {
                    connect();
                }
            }, 0);
        }

        return () => {
            isComponentActive.current = false;
            if (connectTimeout) {
                clearTimeout(connectTimeout);
            }
            disconnect();
        };
    }, [autoConnect, url, websocket, connect, disconnect]);

    const handleClick = () => {
        const currentRfb = getRfb();
        if (!currentRfb) {
            return;
        }

        currentRfb.focus();
    };

    const defaultHandleMouseEnter = () => {
        if (document.activeElement && document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
        }

        handleClick();
    };

    const defaultHandleMouseLeave: MouseEventHandler<HTMLDivElement> = (event) => {
        const relatedTarget = event.relatedTarget;
        if (
            relatedTarget &&
            relatedTarget instanceof HTMLElement &&
            relatedTarget.id === 'noVNC_mouse_capture_elem'
        ) {
            return;
        }

        const currentRfb = getRfb();
        if (!currentRfb) {
            return;
        }

        currentRfb.blur();
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
};

export default VncScreen;
