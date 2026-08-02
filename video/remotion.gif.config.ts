// A second config for the README loops. The main one sets a CRF, and the gif
// codec rejects CRF outright, so the two cannot share a file.
import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('png');
Config.setOverwriteOutput(true);
Config.setChromiumMultiProcessOnLinux(true);
