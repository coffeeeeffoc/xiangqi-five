import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, canMove, findFive, draw, deploy, move, hasAction, canDeployDirectly, deployDirectly } from './game.js';

const at = (x, y) => y * 9 + x;
const piece = (type = 'rook', side = 'red') => ({ type, side });
const boardWith = (type, x = 4, y = 4) => {
  const board = newGame().board;
  board[at(x, y)] = piece(type);
  return board;
};

test('direct deployment is atomic and available even when pieces can move', () => {
  for (const mode of ['xiangqi', 'gomoku']) {
    const s = newGame(mode);
    assert.ok(canDeployDirectly(s));
    const initial = structuredClone(s);
    assert.throws(() => deployDirectly(s, s.board.length));
    assert.deepEqual(s, initial);
    deployDirectly(s, 0, () => 0);
    assert.equal(s.pending, null);
    assert.equal(s.pools.red.length, 15);
    assert.equal(s.ply, 1);
    assert.equal(s.turn, 'black');
    const occupied = structuredClone(s);
    assert.throws(() => deployDirectly(s, 0));
    assert.deepEqual(s, occupied);
    deployDirectly(s, s.board.length - 1, () => .99);
    assert.ok(canMove(s.board, 0, 1, s.cols));
    assert.ok(canDeployDirectly(s));
    deployDirectly(s, 1, () => .99);
    assert.deepEqual(s.board[1], piece('pawn'));
    assert.equal(s.pools.red.length, 14);
    assert.equal(s.ply, 3);
    assert.equal(s.turn, 'black');
    deployDirectly(s, 2, () => 0);
    assert.deepEqual(s.board[2], piece('rook', 'black'));
    assert.equal(s.pools.black.length, 14);
    assert.equal(s.ply, 4);
    assert.equal(s.turn, 'red');
  }
  const blocked = newGame();
  blocked.board[40] = piece('elephant');
  for (const i of [30, 32, 48, 50]) blocked.board[i] = piece('pawn', 'black');
  assert.ok(canDeployDirectly(blocked));
  draw(blocked, () => 0);
  assert.ok(!canDeployDirectly(blocked));
  const pending = structuredClone(blocked);
  assert.throws(() => deployDirectly(blocked, 0));
  assert.deepEqual(blocked, pending);
  for (const setup of [
    (s) => { s.pools.red = []; },
    (s) => { s.result = 'red'; },
    (s) => { s.board.fill(piece()); },
  ]) {
    const s = newGame();
    setup(s);
    const before = structuredClone(s);
    assert.ok(!canDeployDirectly(s));
    assert.throws(() => deployDirectly(s, 0));
    assert.deepEqual(s, before);
  }
});

test('16-piece pools, draw weighting, irrevocable deployment, invalid actions are atomic', () => {
  const s = newGame();
  assert.equal(s.pools.red.length, 16);
  assert.equal(s.pools.red.filter((p) => p === 'pawn').length, 5);
  assert.notEqual(s.pools.red, s.pools.black);
  const before = structuredClone(s);
  assert.throws(() => draw(s, () => 1));
  assert.deepEqual(s, before);
  assert.equal(draw(s, () => 0.9999).type, 'pawn');
  assert.equal(s.pools.red.length, 15);
  assert.throws(() => draw(s));
  assert.throws(() => move(s, 0, 1));
  assert.throws(() => deploy(s, 90));
  deploy(s, 80);
  assert.equal(s.turn, 'black');
  assert.equal(s.pending, null);
  assert.equal(s.ply, 1);
  assert.throws(() => move(s, 80, 71));
  draw(s, () => 0);
  const locked = structuredClone(s);
  assert.throws(() => deploy(s, 80));
  assert.deepEqual(s, locked);
});

test('rook lines and cannon screens, including friendly destinations', () => {
  const b = boardWith('rook');
  assert.ok(canMove(b, 40, 4));
  assert.ok(!canMove(b, 40, 30));
  b[22] = piece('pawn');
  assert.ok(!canMove(b, 40, 4));
  b[40] = piece('cannon');
  assert.ok(!canMove(b, 40, 4));
  b[4] = piece('king', 'black');
  assert.ok(canMove(b, 40, 4));
  b[13] = piece('pawn', 'black');
  assert.ok(!canMove(b, 40, 4));
  b[13] = null; b[22] = null;
  assert.ok(!canMove(b, 40, 4));
  b[4] = null;
  assert.ok(canMove(b, 40, 4));
  b[4] = piece();
  assert.ok(!canMove(b, 40, 4));
});

test('horse legs and elephant eyes; free palace and river movement', () => {
  const b = boardWith('horse');
  for (const [dx, dy] of [[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[-1,2],[1,-2],[-1,-2]]) {
    const to = at(4 + dx, 4 + dy);
    assert.ok(canMove(b, 40, to));
    const leg = at(4 + (Math.abs(dx) === 2 ? Math.sign(dx) : 0), 4 + (Math.abs(dy) === 2 ? Math.sign(dy) : 0));
    b[leg] = piece();
    assert.ok(!canMove(b, 40, to));
    b[leg] = null;
  }
  b[40] = piece('elephant');
  assert.ok(canMove(b, 40, 60));
  b[50] = piece();
  assert.ok(!canMove(b, 40, 60));
  b[50] = null;
  b[40] = piece('advisor');
  assert.ok(canMove(b, 40, 50));
  assert.ok(!canMove(b, 40, 41));
  b[40] = piece('king');
  assert.ok(canMove(b, 40, 41));
  assert.ok(!canMove(b, 40, 50));
  b[4] = piece('king', 'black');
  assert.ok(!canMove(b, 40, 4));
});

test('pawns move one step in all four directions, without river restrictions or row wrapping', () => {
  for (const side of ['red', 'black']) {
    const s = newGame();
    const start = side === 'red' ? at(4, 5) : at(4, 4);
    const step = side === 'red' ? -9 : 9;
    s.board[start] = piece('pawn', side);
    assert.ok(canMove(s.board, start, start + step));
    assert.ok(canMove(s.board, start, start + 1));
    assert.ok(canMove(s.board, start, start - 1));
    assert.ok(canMove(s.board, start, start - step));
    assert.ok(!canMove(s.board, start, start + step + 1));
    assert.ok(!canMove(s.board, start, start + step * 2));
    s.board[start] = null;
    s.board[start + step] = piece('pawn', side);
    assert.ok(canMove(s.board, start + step, start + step + 1));
  }
  const b = newGame().board;
  b[8] = piece('king');
  assert.ok(!canMove(b, 8, 9));
  for (const to of [-1, 90, 0.5, NaN]) assert.ok(!canMove(b, 8, to));
});

test('15x15 board uses its own stride for movement, blocking, deployment and five', () => {
  const s = newGame('gomoku');
  assert.equal(s.board.length, 225);
  assert.throws(() => newGame('__proto__'));
  draw(s, () => 0);
  deploy(s, 224);
  assert.equal(s.board[224].type, 'rook');
  s.turn = 'red';
  move(s, 224, 14);
  assert.equal(s.board[224], null);
  assert.equal(s.board[14].type, 'rook');
  s.board[29] = piece('pawn', 'black');
  assert.ok(!canMove(s.board, 14, 224, s.cols));
  s.board[14] = piece('king');
  assert.ok(!canMove(s.board, 14, 15, s.cols));
  s.board[112] = piece('horse');
  assert.ok(canMove(s.board, 112, 143, s.cols));
  s.board[127] = piece('pawn');
  assert.ok(!canMove(s.board, 112, 143, s.cols));
  for (const [dx, dy, x, y] of [[1,0,10,14],[0,1,14,10],[1,1,10,10],[-1,1,14,10]]) {
    const g = newGame('gomoku');
    for (let n = 0; n < 4; n++) g.board[(y + dy*n)*15+x+dx*n] = piece();
    draw(g, () => 0); deploy(g, (y + dy*4)*15+x+dx*4);
    assert.equal(g.result, 'red');
    assert.equal(g.winningLine.length, 5);
  }
});

test('five in all directions, overlines, gaps, mixed pieces, no row wrapping', () => {
  for (const [dx, dy, x, y] of [[1,0,1,2],[0,1,2,1],[1,1,1,1],[-1,1,7,1]]) {
    const b = newGame().board;
    for (let n = 0; n < 6; n++) b[at(x + dx*n, y + dy*n)] = piece(n % 2 ? 'pawn' : 'king');
    assert.equal(findFive(b, 'red').length, 6);
    assert.deepEqual(findFive(b, 'black'), []);
    b[at(x + dx*2, y + dy*2)] = null;
    assert.deepEqual(findFive(b, 'red'), []);
  }
  const b = newGame().board;
  for (const i of [7,8,9,10,11]) b[i] = piece();
  assert.deepEqual(findFive(b, 'red'), []);
});

test('deploy or capture can win, kings are capturable, victory locks all actions', () => {
  for (const action of ['deploy', 'capture']) {
    const s = newGame();
    for (let i = 0; i < 4; i++) s.board[i] = piece('pawn');
    if (action === 'deploy') { draw(s, () => 0); deploy(s, 4); }
    else {
      s.board[13] = piece(); s.board[4] = piece('king', 'black');
      move(s, 13, 4);
      assert.equal(s.history[0].captured.type, 'king');
      assert.equal(s.pools.black.length, 16);
    }
    assert.equal(s.result, 'red');
    const ended = structuredClone(s);
    assert.throws(() => draw(s));
    assert.throws(() => deploy(s, 5));
    assert.throws(() => move(s, 4, 13));
    assert.deepEqual(s, ended);
  }
});

test('capture removes a threat; depleted pools still allow moves; no action is a draw', () => {
  const s = newGame();
  for (let i = 0; i < 4; i++) s.board[i] = piece('pawn', 'black');
  s.board[11] = piece();
  move(s, 11, 2);
  assert.equal(s.board.filter((p) => p?.side === 'black').length, 3);
  assert.equal(s.result, null);
  s.pools.black = [];
  assert.ok(hasAction(s));
  assert.throws(() => draw(s));
  const empty = newGame();
  empty.pools.black = [];
  draw(empty, () => 0); deploy(empty, 40);
  assert.equal(empty.result, 'draw');
});

test('complete alternating deployment preserves all 32 pieces and exhausts pools', () => {
  const s = newGame();
  for (let i = 0; i < 32; i++) {
    draw(s, () => 0);
    deploy(s, Math.floor(i / 8) * 18 + i % 8);
    assert.equal(s.result, null);
    assert.equal(s.board.filter(Boolean).length + s.pools.red.length + s.pools.black.length, 32);
  }
  assert.equal(s.pools.red.length, 0);
  assert.equal(s.pools.black.length, 0);
  assert.throws(() => draw(s));
});
