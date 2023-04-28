#!/usr/bin/env node
import { program } from 'commander';
import sharp from 'sharp';
import chalk from 'chalk';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import cliProgress from 'cli-progress';
import { createCanvas } from 'canvas';

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

function makeTextImage(text, width, height, fontSize) {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(255, 255, 255, 1)';
    ctx.font = fontSize + 'px Arial';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, Math.ceil(height / 2));
    return canvas.toBuffer('image/png');
}

async function make(file, ignoreOutput) {
    const picDir = fs.mkdtempSync('mvtb');
    try {
        const duration = execSync(
            `ffprobe -i "${file}" -show_entries format=duration -v quiet -of csv="p=0"`
        ).toString();
        const fps = grids / duration;
        const picNum = opts.row * opts.column;
        const picNumLen = `${picNum}`.length;
        const dest = path.resolve(picDir, '%0' + picNumLen + 'd.png');
        const cmd = `ffmpeg -i "${file}" -vf "fps=${fps},scale=${opts.width}:-1" ${dest}`;
        execSync(cmd, { stdio: ignoreOutput ? 'ignore' : 'inherit' });
        const pics = [];
        for (let i = 0; i < picNum; i++) {
            pics.push(
                path.resolve(
                    picDir,
                    (i + 1).toString().padStart(picNumLen, '0') + '.png'
                )
            );
        }
        const dir = path.dirname(file);
        const meta = await sharp(pics[0]).metadata();
        const w = opts.width;
        const h = Math.ceil((w / meta.width) * meta.height);
        const outWidth = w * columns;
        const textHeight = 50;
        const fontSize = 36;
        const headerHeight = textHeight * 2;
        const overlay = [
            {
                input: makeTextImage(
                    'Filename: ' + path.basename(file),
                    outWidth,
                    textHeight,
                    fontSize
                ),
                top: 0,
                left: 0,
            },
            {
                input: makeTextImage(
                    'Duration: ' + sec2str(duration),
                    outWidth,
                    textHeight,
                    fontSize
                ),
                top: textHeight,
                left: 0,
            },
        ];
        const sh = sharp({
            create: {
                width: outWidth,
                height: h * rows + headerHeight,
                channels: 4,
                background: '#000000',
            },
        });
        let left = 0;
        let top = headerHeight;
        for (let i = 0; i < pics.length; i++) {
            const p = await sharp(pics[i])
                .resize({ width: w, height: h })
                .toBuffer();
            overlay.push({
                input: p,
                top,
                left,
            });
            left = (i + 1) % columns === 0 ? 0 : left + w;
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

program
    .name('mvtb')
    .description('MoVie ThumBnail generator')
    .option('-f, --file <string>', 'movie file')
    .option('-d, --directory <string>', 'movie directory')
    .option(
        '-e, --ext <string>',
        'file extensions, split by |',
        'avi|wmv|mp4|mov|rmvb|mkv|m4v|flv|3gp'
    )
    .option('-R, --row <number>', 'thumb rows', 4)
    .option('-C, --column <number>', 'thumb columns', 4)
    .option('-W, --width <number>', 'thumb width', 250);

program.parse();

const opts = program.opts();
const rows = Math.ceil(opts.row);
if (rows <= 0) {
    error('Invalid row');
}
const columns = Math.ceil(opts.column);
if (columns <= 0) {
    error('Invalid column');
}
const grids = rows * columns;

if (opts.file) {
    await make(opts.file, false);
} else if (opts.directory) {
    console.log('\n');
    const reg = new RegExp(`\.(${opts.ext})$`, 'i');
    const files = fs
        .readdirSync(opts.directory)
        .filter((item) => !item.startsWith('.') && reg.test(item));
    if (files.length > 0) {
        const bar = new cliProgress.SingleBar({
            format: ' {bar} | {filename} | {value}/{total}',
        });
        bar.start(files.length, 0);
        for (let i = 0; i < files.length; i++) {
            const file = path.resolve(opts.directory, files[i]);
            bar.update(i + 1, { filename: files[i] });
            bar.render();
            await make(file, true);
        }
        bar.stop();
    }
} else {
    error('Please specify file or directory');
}

