#!/usr/bin/env node
import { program } from 'commander';
import sharp from 'sharp';
import chalk from 'chalk';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import TextToSVG from 'text-to-svg';
import cliProgress from 'cli-progress';

function error(msg) {
    console.log(chalk.red(msg));
}

function sec2str(s) {
    const h = Math.floor(s / 3600);
    s -= h * 3600;
    const m = Math.floor(s / 60);
    s -= m * 60;
    const [a, _] = `${s}`.split('.');
    const r = [h, m, a].map((item) => ('' + item).padStart(2, '0')).join(':');
    return r;
}

program
    .name('mvtb')
    .description('MoVie ThumBnail generator')
    .option('-f, --file <string>', 'movie file')
    .option('-d, --directory <string>', 'movie directory')
    .option(
        '-e, --ext <string>',
        'file extensions, split by |',
        'avi|wmv|mp4|mov|rmvb'
    )
    .option('-R, --row <number>', 'thumb rows', 4)
    .option('-C, --column <number>', 'thumb columns', 4)
    .option('-W, --width <number>', 'thumb width', 250);

program.parse();

const opts = program.opts();
opts.row = Math.ceil(opts.row);
if (opts.row <= 0) {
    error('Invalid row');
}
opts.column = Math.ceil(opts.column);
if (opts.column <= 0) {
    error('Invalid column');
}
const grids = opts.row * opts.column;

if (opts.file) {
    const bar = new cliProgress.SingleBar({
        format: ' {bar} | {value}/{total}',
    });
    bar.start(grids, 0);
    await make(opts.file, bar);
    bar.stop();
} else if (opts.directory) {
    const reg = new RegExp(`\.(${opts.ext})$`, 'i');
    const files = fs
        .readdirSync(opts.directory)
        .filter((item) => reg.test(item));
    if (files.length > 0) {
        const bars = new cliProgress.MultiBar({
            format: ' {bar} | {filename} | {value}/{total}',
        });
        const b1 = bars.create(files.length, 0, { filename: 'ALL' });
        const b2 = bars.create(grids, 0, { filename: '' });
        for (let i = 0; i < files.length; i++) {
            const file = path.resolve(opts.directory, files[i]);
            await make(file, b2, bars);
            b1.increment();
            bars.update();
        }
        bars.stop();
    }
} else {
    error('Please specify file or directory');
}

async function make(file, bar, bars) {
    bar.update(0, { filename: path.basename(file) });
    bars && bars.update();
    const picDir = fs.mkdtempSync('mvtb');
    try {
        const duration = execSync(
            `ffprobe -i "${file}" -show_entries format=duration -v quiet -of csv="p=0"`
        ).toString();
        const picNum = opts.row * opts.column;
        const space = duration / picNum;
        const pics = [];
        let t = 0;
        const picNumLen = `${picNum}`.length;
        for (let i = 1; i <= picNum; i++) {
            const pic = path.resolve(
                picDir,
                ('' + i).padStart(picNumLen, '0') + '.png'
            );
            const ts = sec2str(t);
            execSync(
                `ffmpeg -ss ${ts} -i "${file}" -y -f image2 -vframes 1 "${pic}"`,
                {
                    stdio: 'ignore',
                }
            );
            t += space;
            pics.push({
                pic,
                ts,
            });
            bar.increment();
            bars && bars.update();
        }
        const dir = path.dirname(file);
        const meta = await sharp(pics[0].pic).metadata();
        const w = opts.width;
        const h = Math.ceil((w / meta.width) * meta.height);
        const r = opts.row;
        const c = opts.column;
        const sh = sharp({
            create: {
                width: w * c,
                height: h * r,
                channels: 4,
                background: '#000000',
            },
        });
        const tts = TextToSVG.loadSync();
        const overlay = [];
        let left = 0;
        let top = 0;
        for (let i = 0; i < pics.length; i++) {
            const svg = tts.getSVG(pics[i].ts, {
                x: 0,
                y: 0,
                fontSize: 20,
                anchor: 'top',
                attributes: {
                    stroke: 'white',
                    fill: 'white',
                },
            });
            const txt = sharp(Buffer.from(svg));
            const txtMeta = await txt.metadata();
            if (txtMeta.width > w) {
                txt.resize({ width: w });
            }
            const p = await sharp(pics[i].pic)
                .resize({ width: w, height: h })
                .composite([
                    { input: await txt.toBuffer(), gravity: 'southeast' },
                ])
                .toBuffer();
            overlay.push({
                input: p,
                top,
                left,
            });
            left = (i + 1) % c === 0 ? 0 : left + w;
            if (left === 0) {
                top += h;
            }
        }
        await sh
            .composite(overlay)
            .toFile(
                path.resolve(
                    dir,
                    path.basename(file).replace(/\.[^/.]+$/, '') + '.jpg'
                )
            );
    } catch (e) {
        error(`FAIL: ${file}`);
        console.error(e);
    } finally {
        fs.rm(picDir, { recursive: true, force: true }, (err) => {
            if (err) {
                console.error(err);
            }
        });
    }
}

