// TEMPORARY — still-check entry for ActLaptop. Deleted after the checks.
import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { FPS } from './lib/beats';
import { ActLaptop } from './scenes/ActLaptop';

const Root: React.FC = () => (
  <Composition
    id="LaptopCheck"
    component={ActLaptop}
    durationInFrames={384}
    fps={FPS}
    width={1920}
    height={1080}
  />
);

registerRoot(Root);
