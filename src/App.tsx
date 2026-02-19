import React, { useRef, useState } from 'react';
import './App.css';
import { VncScreen } from './lib';

const spacerStyle = { width: '2rem', display: 'inline-block' } as const;

function App() {
  const [vncUrl, setVncUrl] = useState('');
  const [inputUrl, setInputUrl] = useState('');
  const [clipboardText, setClipboardText] = useState('');
  const vncScreenRef = useRef<React.ElementRef<typeof VncScreen>>(null);

  const isValid = (vncUrl: string) => {
    if (!vncUrl.startsWith('ws://') && !vncUrl.startsWith('wss://')) {
      return false;
    }

    return true;
  };

  return (
    <>
      <div style={{ margin: '1rem' }}>
        <label htmlFor="url">URL for VNC Stream</label>
        <div style={spacerStyle} />

        <input type="text" onChange={({ target: { value } }) => {
          setInputUrl(value);
        }} name="url" placeholder="wss://your-vnc-url" />

        <div style={spacerStyle} />
        <button onClick={() => setVncUrl(inputUrl)}>Go!</button>
      </div>

      <div style={{ opacity: 0.5, margin: '1rem' }}>
        Since the site is loaded over HTTPS, only `wss://` URLs (SSL encrypted websockets URLs) are supported.
        <br />
        To test a `ws://` URL, clone the application and run it on http://localhost:3000, or <a href="https://experienceleague.adobe.com/docs/target/using/experiences/vec/troubleshoot-composer/mixed-content.html?lang=en#task_5448763B8DC941FD80F84041AEF0A14D">enable Mixed Content on your browser</a>.
      </div>

      <div style={{ margin: '1rem' }}>
        <button
          onClick={() => {
            const { connect, connected, disconnect } = vncScreenRef.current ?? {};
            if (connected) {
              disconnect?.();
              return;
            }
            connect?.();
          }}
        >
          Connect / Disconnect
        </button>
      </div>

      <div style={{ margin: '1rem' }}>
        <label htmlFor="clipboard-input">Clipboard Text</label>
        <div style={spacerStyle} />
        <input
          id="clipboard-input"
          data-testid="clipboard-input"
          type="text"
          onChange={({ target: { value } }) => {
            setClipboardText(value);
          }}
          value={clipboardText}
          placeholder="text to send to remote clipboard"
        />
        <div style={spacerStyle} />
        <button
          data-testid="clipboard-send"
          onClick={() => {
            vncScreenRef.current?.clipboardPaste(clipboardText);
          }}
        >
          Send Clipboard
        </button>
      </div>

      <div style={{ margin: '1rem' }}>
        {
          isValid(vncUrl)
            ?
            (
              <VncScreen
                url={vncUrl}
                scaleViewport
                background="#000000"
                style={{
                  width: '75vw',
                  height: '75vh',
                }}
                debug
                ref={vncScreenRef}
              />
            )
            : <div>VNC URL not provided.</div>
        }
      </div>
    </>
  );
}

export default App;
