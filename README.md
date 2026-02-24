[![Issues][issues-shield]][issues-url]

<!-- PROJECT LOGO -->
<br />
<p align="center">
  <!-- <a href="https://github.com/chikingsley/react-vnc">
    <img src="https://project-logo.png" alt="Logo" width="80">
  </a> -->

  <h3 align="center">react-vnc</h3>

  <p align="center">
    A React Component to connect to a websockified VNC client using noVNC.
    <br />
    <a href="https://github.com/chikingsley/react-vnc"><strong>Explore the docs »</strong></a>
    <br />
    <br />
    <a href="https://roerohan.github.io/react-vnc/">View Demo</a>
    ·
    <a href="https://github.com/chikingsley/react-vnc/issues">Report Bug</a>
    ·
    <a href="https://github.com/chikingsley/react-vnc/issues">Request Feature</a>
  </p>
</p>



<!-- TABLE OF CONTENTS -->
## Table of Contents

* [About the Project](#about-the-project)
  * [Built With](#built-with)
  * [Demo](#demo)
* [Getting Started](#getting-started)
  * [Prerequisites](#prerequisites)
  * [Installation](#installation)
* [Usage](#usage)
* [Roadmap](#roadmap)
* [Contributing](#contributing)
* [License](#license)
* [Contributors](#contributors-)



<!-- ABOUT THE PROJECT -->
## About The Project

[noVNC](https://github.com/novnc/noVNC) is a VNC client web application using which you can view a VNC stream directly on a browser. It uses [websockify](https://github.com/novnc/websockify) to convert the VNC stream into a websocket stream, which can be viewed on a browser. This library provides a `React` component wrapper around the `noVNC` web client.

Using this library, you can easily display a VNC stream on a page of your web application. [Here](#usage) is an example.

### Demo

A demo website using the `react-vnc` library is hosted on [https://roerohan.github.io/react-vnc/](https://roerohan.github.io/react-vnc/). The source for this application can be found in [src/App.tsx](./src/App.tsx).

<img src="./public/demo.png" alt="demo" width="800">


### Built With

* [React](https://reactjs.org)
* [noVNC](https://github.com/novnc/noVNC)



<!-- GETTING STARTED -->
## Getting Started

### Installation

To install the library, you can run the following command:

```bash
bun add @chikingsley/react-vnc
```

### Contribution

In order to run the project locally, follow these steps:

1. Clone the repository.
```bash
git clone git@github.com:chikingsley/react-vnc.git
cd react-vnc
```

2. Install the packages and submodules.
```bash
bun install
git submodule update --init --recursive
```

3. To run the sample `react-vnc` web application:
```bash
echo "REACT_APP_VNC_URL=ws://your-vnc-url.com" > .env
bun run start
```

4. To build the library, make changes inside the `lib` folder, then run:
```bash
bun run build:lib
```

5. To run unit tests:
```bash
bun run test
```

6. Install Playwright Chromium once:
```bash
bun run e2e:install
```

7. To run real browser integration tests against a dockerized VNC target:
```bash
bun run test:real
```
This requires Docker and will spin up a disposable VNC + websockify container.

8. To run browser tests in headed or UI mode:
```bash
bun run test:real:headed
bun run test:real:ui
```
`test:real:headed` runs visible Chromium for one pass.  
`test:real:ui` opens Playwright UI mode so you can repeatedly run/debug tests interactively.

If you want a visibly slower run you can watch end-to-end:
```bash
bun run test:real:watch
```

If you want step debugging:
```bash
bun run test:real:debug
```

If you want an inspectable HTML report:
```bash
bun run test:real:report
```

9. If you already have the VNC target running and want to skip Docker orchestration:
```bash
E2E_USE_DOCKER=0 bun run e2e:test
```

### Test Layout

All tests now live under the top-level `tests/` directory:

- `tests/unit/`: Bun unit tests for library behavior
- `tests/e2e/specs/`: Playwright end-to-end tests
  - covers live connect/render, clipboard transport send path, and reconnect regression protection
- `tests/e2e/global-setup.ts`: Dockerized VNC stack startup for Playwright runs
- `tests/e2e/global-teardown.ts`: Dockerized VNC stack cleanup
- `tests/vnc-server/`: disposable VNC fixture image (Xvfb + x11vnc + websockify)


<!-- USAGE EXAMPLES -->
## Usage

A `VncScreen` component is exposed from the library, to which you can pass the required and optional props. For example,

```ts
import React, { useRef } from 'react';
import { VncScreen } from 'react-vnc';

function App() {
  const ref = useRef();

  return (
    <VncScreen
      url='ws://your-vnc-url.com'
      scaleViewport
      background="#000000"
      style={{
        width: '75vw',
        height: '75vh',
      }}
      ref={ref}
    />
  );
}

export default App;
```

### Using Pre-Authenticated WebSocket

If you need to handle authentication or perform a custom handshake before establishing the VNC connection, you can pass a pre-authenticated WebSocket instance instead of a URL:

```ts
import React, { useEffect, useState } from 'react';
import { VncScreen } from 'react-vnc';

function App() {
  const [websocket, setWebsocket] = useState<WebSocket | null>(null);

  useEffect(() => {
    // Create WebSocket and handle authentication
    const ws = new WebSocket('ws://your-vnc-server.com');
    
    ws.addEventListener('open', () => {
      // Perform custom authentication or handshake
      ws.send(JSON.stringify({ token: 'your-auth-token' }));
    });

    ws.addEventListener('message', (event) => {
      const response = JSON.parse(event.data);
      if (response.authenticated) {
        // Once authenticated, pass the WebSocket to VncScreen
        setWebsocket(ws);
      }
    });

    return () => {
      ws.close();
    };
  }, []);

  if (!websocket) {
    return <div>Authenticating...</div>;
  }

  return (
    <VncScreen
      websocket={websocket}
      scaleViewport
      style={{
        width: '75vw',
        height: '75vh',
      }}
    />
  );
}

export default App;
```

This approach is particularly useful for:
- Cookie-based authentication
- Custom authentication protocols
- Connection pooling or reuse
- Advanced WebSocket configuration

### Credentials Shape

When using `rfbOptions`, credentials must be nested under `credentials`:

```ts
<VncScreen
  url="wss://your-vnc-url.com"
  rfbOptions={{
    credentials: {
      password: "your-password",
      username: "optional-username",
      target: "optional-target",
    },
  }}
/>
```

Either `url` or `websocket` is required:
- **`url`**: A `ws://` or `wss://` websocket URL to connect to the VNC server
- **`websocket`**: A pre-authenticated WebSocket instance (useful for custom authentication flows)

All other props to `VncScreen` are optional. The following is a list (an interface) of all props along with their types.

```ts
type EventListeners = { [T in NoVncEventType]?: (event: NoVncEvents[T]) => void };

type ServerVerificationInfo = {
    type: string;
    publickey?: Uint8Array;
    fingerprint?: string;
    receivedAt: string;
};

type ServerVerificationContext = {
    rfb: RFB | null;
    info: ServerVerificationInfo;
    approve: () => void;
    reject: () => void;
};

interface Props {
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
      context: ServerVerificationContext
    ) => void;
    onSecurityFailure?: EventListeners['securityfailure'];
    onClipboard?: EventListeners['clipboard'];
    onBell?: EventListeners['bell'];
    onDesktopName?: EventListeners['desktopname'];
    onCapabilities?: EventListeners['capabilities'];
    onClippingViewport?: EventListeners['clippingviewport'];
    autoApproveServerVerification?: boolean;
    onChildMouseLeave?: React.MouseEventHandler<HTMLDivElement>;
    onChildMouseEnter?: React.MouseEventHandler<HTMLDivElement>;
}

// The types NoVncOptions, NoVncEventType and NoVncEvents are from the
// @novnc/novnc library.
```

To know more about these props, check out [API.md](https://github.com/novnc/noVNC/blob/master/docs/API.md#properties).

You can pass a `ref` to the `VncScreen` component, and access the `connect()` and `disconnect()` methods from the library. Check out [#18](https://github.com/chikingsley/react-vnc/issues/18) for more details.

The `ref` object has the following type:
```ts
type VncScreenHandle = {
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
    rfb: RFB | null;
    loading: boolean;
    lastServerVerification: ServerVerificationInfo | null;
    eventListeners: EventListeners;
};
```

The `onConnect`, `onDisconnect`, `onCredentialsRequired`, and `onDesktopName` props are optional, and there are existing defaults set for them. For example, the default disconnect behavior retries only on unexpected disconnects (`detail.clean === false`) when `autoConnect` is enabled and a raw `websocket` instance is not provided. Retry delay is controlled by `retryDuration` and total attempts are bounded by `maxRetries` (default `10`).

When omitted, `focusOnClick` defaults to `true` and `background` defaults to `'rgb(40, 40, 40)'`, matching upstream noVNC defaults.

When `onDisconnect` is provided, your callback still runs, and the built-in retry policy is still applied by default.

Event callbacks receive the corresponding noVNC event object. To access the active `RFB` object, use `ref.current?.rfb`.

Server verification is manual by default. If the server emits `serververification`, provide `onServerVerification` and call `context.approve()` after validating identity, or set `autoApproveServerVerification={true}` to skip manual verification.

<!-- ROADMAP -->
## Roadmap

See the [open issues](https://github.com/chikingsley/react-vnc/issues) for a list of proposed features (and known issues).



<!-- CONTRIBUTING -->
## Contributing

Contributions are what make the open source community such an amazing place to be learn, inspire, and create. Any contributions you make are **greatly appreciated**.

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'feat: Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

You are requested to follow the contribution guidelines specified in [CONTRIBUTING.md](./CONTRIBUTING.md) while contributing to the project :smile:.

<!-- LICENSE -->
## License

Distributed under the MIT License. See [`LICENSE`](./LICENSE) for more information.




<!-- MARKDOWN LINKS & IMAGES -->
<!-- https://www.markdownguide.org/basic-syntax/#reference-style-links -->
[roerohan-url]: https://roerohan.github.io
[issues-shield]: https://img.shields.io/github/issues/chikingsley/react-vnc.svg?style=flat-square
[issues-url]: https://github.com/chikingsley/react-vnc/issues
