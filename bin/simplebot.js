#!/usr/bin/env node
import { runCli } from '../server/dist/cli.js';

process.exitCode = await runCli(process.argv.slice(2));
