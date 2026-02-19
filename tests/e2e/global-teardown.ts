import { downDockerizedVnc } from './support/docker';

async function globalTeardown() {
    if (process.env.E2E_USE_DOCKER === '0') {
        return;
    }

    downDockerizedVnc();
}

export default globalTeardown;
