import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(95);
Config.setCodec('h264');
Config.setCrf(17);
Config.setOverwriteOutput(true);

// The render box has 4 cores and 7GB. Chromium's Linux default used to be
// single-process, which caps throughput hard; keep multi-process on and let the
// CLI pick concurrency (measured with `remotion benchmark`, not guessed).
Config.setChromiumMultiProcessOnLinux(true);
