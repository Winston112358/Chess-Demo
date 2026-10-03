'use strict';

/**
 * Fake UCI-like child process for native-transport tests.
 * Modes are selected with argv[2]; default speaks a tiny protocol subset.
 */
const mode = process.argv[2] ?? 'default';

function out(text) {
  process.stdout.write(text);
}

function line(text) {
  process.stdout.write(`${text}\n`);
}

if (mode === 'late') {
  let tick = 0;
  setInterval(() => {
    tick += 1;
    line(`tick:${tick}`);
  }, 20);
} else if (mode === 'ignore-quit') {
  line(`pid:${process.pid}`);
  setInterval(() => {}, 1000);
} else if (mode === 'exit-now') {
  line(`pid:${process.pid}`);
  process.exit(3);
} else if (mode === 'stderr-exit') {
  process.stderr.write('boom-diagnostic-line\n');
  process.exit(4);
} else {
  process.stdin.setEncoding('utf8');
  let buffer = '';
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const command = buffer.slice(0, index).replace(/\r$/, '');
      buffer = buffer.slice(index + 1);
      handle(command);
    }
  });
  process.stdin.on('end', () => process.exit(0));
}

function handle(command) {
  if (command === 'uci') {
    out('id name Fake Engine\r\nid author transport-tests\n');
    out('uciok\n');
  } else if (command === 'isready') {
    line('readyok');
  } else if (command === 'split') {
    out('part1');
    setTimeout(() => out('-part2\nfull-line\n'), 20);
  } else if (command === 'stderr') {
    process.stderr.write('diagnostic-noise-123\n');
    line('after-stderr');
  } else if (command === 'tail-exit') {
    out('tail-no-newline');
    setTimeout(() => process.exit(0), 20);
  } else if (command === 'quit') {
    process.exit(0);
  } else if (command.startsWith('echo ')) {
    line(`echo:${command.slice(5)}`);
  }
}
