import '@novnc/novnc/lib/rfb';

declare module '@novnc/novnc/lib/rfb' {
    interface NoVncEvents {
        serververification: CustomEvent<{
            type: string;
            publickey?: Uint8Array;
        }>;
    }
}
