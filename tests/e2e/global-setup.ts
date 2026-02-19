import { upDockerizedVnc } from './support/docker';

async function globalSetup() {
    if (process.env.E2E_USE_DOCKER === '0') {
        return;
    }

    await upDockerizedVnc();
}

export default globalSetup;
