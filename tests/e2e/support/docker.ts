import { execFileSync } from 'node:child_process';
import net from 'node:net';

const COMPOSE_FILE = 'docker-compose.e2e.yml';
const WAIT_TIMEOUT_MS = 60_000;

const runCompose = (...args: string[]) => {
    execFileSync('docker', ['compose', '-f', COMPOSE_FILE, ...args], {
        stdio: 'inherit',
    });
};

const canConnect = (port: number) =>
    new Promise<boolean>((resolve) => {
        const socket = net.createConnection({ host: '127.0.0.1', port });
        socket.once('connect', () => {
            socket.end();
            resolve(true);
        });
        socket.once('error', () => resolve(false));
        socket.setTimeout(750, () => {
            socket.destroy();
            resolve(false);
        });
    });

export const upDockerizedVnc = async () => {
    runCompose('up', '-d', '--build');

    const deadline = Date.now() + WAIT_TIMEOUT_MS;
    const ports = [5900, 6080];

    while (Date.now() < deadline) {
        const checks = await Promise.all(ports.map((port) => canConnect(port)));
        if (checks.every(Boolean)) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    runCompose('logs');
    throw new Error('Timed out waiting for dockerized VNC services');
};

export const downDockerizedVnc = () => {
    try {
        runCompose('down', '-v', '--remove-orphans');
    } catch {
        // Ignore cleanup failures to avoid masking real test failures.
    }
};
