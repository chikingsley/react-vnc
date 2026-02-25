import '@novnc/novnc/lib/rfb';

declare module '@novnc/novnc/lib/rfb' {
    interface NoVncEvents {
        serververification: CustomEvent<{
            type: string;
            publickey?: Uint8Array;
        }>;
    }

    // Added in noVNC 1.7.0-beta, not yet in @types/novnc__novnc@1.6.0
    export default interface NoVncClient {
        approveServer(): void;
    }
}
