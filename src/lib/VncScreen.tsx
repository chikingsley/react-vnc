import React, {
    forwardRef,
    MouseEventHandler,
    useCallback,
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

type RuntimeConfig = {
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
    autoConnect: boolean;
    retryDuration: number;
    maxRetries: number;
    debug: boolean;
    autoApproveServerVerification: boolean;
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
};

const VncScreen: React.ForwardRefRenderFunction<VncScreenHandle, Props> = (props, ref) => {
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

    const connectRef = useRef<() => void>(() => {});
    const disconnectRef = useRef<() => void>(() => {});

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

    const configRef = useRef<RuntimeConfig>({
        url,
        websocket,
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
        autoConnect,
        retryDuration,
        maxRetries: normalizedMaxRetries,
        debug,
        autoApproveServerVerification,
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
    });

    useEffect(() => {
        configRef.current = {
            url,
            websocket,
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
            autoConnect,
            retryDuration,
            maxRetries: normalizedMaxRetries,
            debug,
            autoApproveServerVerification,
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
        };
    }, [
        autoApproveServerVerification,
        autoConnect,
        background,
        clipViewport,
        compressionLevel,
        debug,
        dragViewport,
        focusOnClick,
        maxRetries,
        normalizedMaxRetries,
        onBell,
        onCapabilities,
        onClipboard,
        onClippingViewport,
        onConnect,
        onCredentialsRequired,
        onDesktopName,
        onDisconnect,
        onSecurityFailure,
        onServerVerification,
        qualityLevel,
        resizeSession,
        retryDuration,
        rfbOptions,
        scaleViewport,
        showDotCursor,
        url,
        viewOnly,
        websocket,
    ]);

    const info = useCallback((...args: any[]) => {
        if (configRef.current.debug) {
            console.info(...args);
        }
    }, []);

    const error = useCallback((...args: any[]) => {
        console.error(...args);
    }, []);

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

    const rejectServer = useCallback(() => {
        disconnectRef.current();
    }, []);

    const _onConnect = useCallback((event: NoVncEvents['connect']) => {
        const { onConnect: onConnectHandler } = configRef.current;
        onConnectHandler?.(event);

        if (!onConnectHandler) {
            info('Connected to remote VNC.');
        }

        retryAttempts.current = 0;
        credentialsMissing.current = false;
        setLoading(false);
    }, [info]);

    const _onDisconnect: EventListeners['disconnect'] = useCallback((event: NoVncEvents['disconnect']) => {
        const config = configRef.current;
        config.onDisconnect?.(event);

        const clean = (event as { detail?: { clean?: boolean } }).detail?.clean === true;
        const hasRetriesRemaining = retryAttempts.current < config.maxRetries;
        const shouldRetry =
            !clean &&
            config.autoConnect &&
            !config.websocket &&
            !credentialsMissing.current &&
            hasRetriesRemaining &&
            isComponentActive.current;

        if (shouldRetry) {
            const nextAttempt = retryAttempts.current + 1;
            retryAttempts.current = nextAttempt;

            info(
                `Unexpectedly disconnected from remote VNC, retrying in ${config.retryDuration / 1000} seconds ` +
                `(attempt ${nextAttempt}/${config.maxRetries}).`,
            );

            setRfb(null);
            clearRetryTimeout();
            retryTimeout.current = setTimeout(() => {
                if (!isComponentActive.current) {
                    return;
                }

                connectRef.current();
            }, config.retryDuration);
        } else if (!clean && config.autoConnect && !config.websocket && !hasRetriesRemaining) {
            info(`Disconnected from remote VNC. Max retries reached (${config.maxRetries}).`);
        } else {
            info('Disconnected from remote VNC.');
        }

        setLoading(true);
    }, [clearRetryTimeout, info]);

    const _onCredentialsRequired: EventListeners['credentialsrequired'] = useCallback((event: NoVncEvents['credentialsrequired']) => {
        const currentRfb = getRfb();
        const {
            onCredentialsRequired: onCredentialsRequiredHandler,
            rfbOptions: currentRfbOptions,
        } = configRef.current;

        if (onCredentialsRequiredHandler) {
            onCredentialsRequiredHandler(event);
            return;
        }

        const requestedTypes = (event as { detail?: { types?: string[] } }).detail?.types ?? [];
        const credentials = currentRfbOptions?.credentials;

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
    }, [error]);

    const _onDesktopName: EventListeners['desktopname'] = useCallback((event: NoVncEvents['desktopname']) => {
        const { onDesktopName: onDesktopNameHandler } = configRef.current;
        onDesktopNameHandler?.(event);

        if (!onDesktopNameHandler) {
            info(`Desktop name is ${event.detail.name}`);
        }
    }, [info]);

    const _onSecurityFailure: EventListeners['securityfailure'] = useCallback((event: NoVncEvents['securityfailure']) => {
        configRef.current.onSecurityFailure?.(event);
    }, []);

    const _onClipboard: EventListeners['clipboard'] = useCallback((event: NoVncEvents['clipboard']) => {
        configRef.current.onClipboard?.(event);
    }, []);

    const _onBell: EventListeners['bell'] = useCallback((event: NoVncEvents['bell']) => {
        configRef.current.onBell?.(event);
    }, []);

    const _onCapabilities: EventListeners['capabilities'] = useCallback((event: NoVncEvents['capabilities']) => {
        configRef.current.onCapabilities?.(event);
    }, []);

    const _onClippingViewport: EventListeners['clippingviewport'] = useCallback((event: NoVncEvents['clippingviewport']) => {
        configRef.current.onClippingViewport?.(event);
    }, []);

    const _onServerVerification = useCallback(async (event: NoVncEvents['serververification']) => {
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

        const { onServerVerification: onServerVerificationHandler, autoApproveServerVerification: shouldAutoApprove } =
            configRef.current;

        if (onServerVerificationHandler) {
            onServerVerificationHandler(event, context);
            return;
        }

        if (shouldAutoApprove) {
            info('Auto-approving server verification. Provide onServerVerification for manual verification.');
            approveServer();
            return;
        }

        info(
            'Server verification required. Provide onServerVerification and call context.approve() ' +
            'after validating identity, or set autoApproveServerVerification=true.',
        );
    }, [approveServer, getServerFingerprint, info, rejectServer]);

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

            // NOTE(roerohan): This needs to be called since the event listener is removed.
            // Even if the event listener is removed after rfb.disconnect(), the disconnect
            // event is not fired.
            _onDisconnect(new CustomEvent('disconnect', { detail: { clean: true } }));
        } catch (err) {
            error(err);
            setRfb(null);
            setConnected(false);
        }
    }, [_onDisconnect, clearRetryTimeout, error]);

    const connect = useCallback(() => {
        try {
            if (getConnected() && getRfb()) {
                disconnect();
            }

            if (!screen.current) {
                return;
            }

            const config = configRef.current;
            if (!config.url && !config.websocket) {
                error('Either url or websocket must be provided');
                setConnected(false);
                return;
            }

            credentialsMissing.current = false;
            clearRetryTimeout();
            screen.current.replaceChildren();

            const currentRfb = new RFB(screen.current, config.websocket || config.url!, config.rfbOptions);

            currentRfb.viewOnly = config.viewOnly ?? false;
            currentRfb.focusOnClick = config.focusOnClick ?? false;
            currentRfb.clipViewport = config.clipViewport ?? false;
            currentRfb.dragViewport = config.dragViewport ?? false;
            currentRfb.resizeSession = config.resizeSession ?? false;
            currentRfb.scaleViewport = config.scaleViewport ?? false;
            currentRfb.showDotCursor = config.showDotCursor ?? false;
            currentRfb.background = config.background ?? '';
            currentRfb.qualityLevel = config.qualityLevel ?? 6;
            currentRfb.compressionLevel = config.compressionLevel ?? 2;
            setRfb(currentRfb);

            eventListeners.current = {
                connect: _onConnect,
                disconnect: _onDisconnect,
                credentialsrequired: _onCredentialsRequired,
                securityfailure: _onSecurityFailure,
                clipboard: _onClipboard,
                bell: _onBell,
                desktopname: _onDesktopName,
                capabilities: _onCapabilities,
                clippingviewport: _onClippingViewport,
                serververification: _onServerVerification,
            };

            (Object.keys(eventListeners.current) as (NoVncEventType)[]).forEach((eventName) => {
                if (eventListeners.current[eventName]) {
                    currentRfb.addEventListener(eventName, eventListeners.current[eventName]!);
                }
            });

            setConnected(true);
        } catch (err) {
            error(err);
            setConnected(false);
        }
    }, [
        _onBell,
        _onCapabilities,
        _onClipboard,
        _onConnect,
        _onCredentialsRequired,
        _onDesktopName,
        _onDisconnect,
        _onSecurityFailure,
        _onServerVerification,
        _onClippingViewport,
        clearRetryTimeout,
        disconnect,
        error,
    ]);

    useEffect(() => {
        connectRef.current = connect;
        disconnectRef.current = disconnect;
    }, [connect, disconnect]);

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

export default forwardRef(VncScreen);
