/** Assemble a restored Release shell with the renderer and service staged for this architecture. */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { signApp } from '../signing/sign-app.mjs';
import { checkUpgradeCompatibility } from '../signing/upgrade-compat.mjs';

if (!process.env.APP) throw new Error('APP must name the restored native app.');
const app = path.resolve(process.env.APP);
const embed = fileURLToPath(new URL('./embed-components.sh', import.meta.url));
execFileSync('/bin/bash', [embed, path.join(app, 'Contents/Resources')], { stdio: 'inherit' });
checkUpgradeCompatibility(app);
await signApp(app);
