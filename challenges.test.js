import test from 'node:test';
import assert from 'node:assert/strict';
import { canMove, move, findFive } from './game.js';
import { legalActions, winningActions } from './computer.js';
import { CHALLENGES, createChallengeState, challengeOutcome, challengeReply, challengeMilestones, recommendedChallenge, challengeInvitation, challengeFromUrl, challengeLink, decodeChallengeProgress } from './challenges.js';

test('all curated positions are legal mixed-chess one-move exercises, independently enumerate every answer', () => {
  const recommended = { 'rook-bridge': [14, 41], 'horse-leg': [21, 40], 'elephant-eye': [55, 39], 'cannon-link': [11, 47], 'pawn-return': [11, 20], 'break-threat': [67, 13] };
  for (const puzzle of CHALLENGES.filter((item) => item.goal !== 'two-turn')) {
    const initial = createChallengeState(puzzle.id);
    assert.equal(challengeOutcome(puzzle.id, initial), 'playing');
    assert.equal(findFive(initial.board, 'red').length, 0);
    assert.equal(findFive(initial.board, 'black').length, 0);
    assert.deepEqual(initial.pools, { red: [], black: [] });
    const solutions = [];
    let failed = 0;
    for (const action of legalActions(initial)) {
      const state = structuredClone(initial);
      move(state, action.from, action.to);
      // Independently verify the actual rule objective rather than the declared answer.
      const correct = puzzle.goal === 'five' ? findFive(state.board, 'red').length >= 5 :
        legalActions({ ...state, turn: 'black' }).every((reply) => {
          const after = structuredClone(state);
          move(after, reply.from, reply.to);
          return findFive(after.board, 'black').length === 0;
        });
      assert.equal(challengeOutcome(puzzle.id, state), correct ? 'solved' : 'failed');
      if (correct) solutions.push([action.from, action.to]); else failed++;
    }
    assert.ok(solutions.some(([from, to]) => from === recommended[puzzle.id][0] && to === recommended[puzzle.id][1]), puzzle.id);
    assert.ok(failed > 0, 'each challenge has legal moves that fail its objective');
    if (puzzle.goal === 'five') assert.equal(solutions.length, 1, `${puzzle.id} has a unique winning move`);
    else assert.ok(solutions.length > 1, 'all sound defenses are accepted');
  }
});

test('two-turn exercises withstand every legal defense and accept every genuine final five', () => {
  const expected = { crossroads: [[43, 40]], 'cannon-cross': [[31, 40], [43, 40]] };
  for (const puzzle of CHALLENGES.filter((item) => item.goal === 'two-turn')) {
    const initial = createChallengeState(puzzle.id), forced = [];
    let multipleFinishes = false, refutableStarts = 0;
    for (const start of legalActions(initial)) {
      const state = structuredClone(initial); move(state, start.from, start.to);
      assert.equal(findFive(state.board, 'red').length, 0, 'the new puzzle cannot be completed in one move');
      assert.equal(challengeOutcome(puzzle.id, state), 'playing');
      const snapshot = structuredClone(state), defender = challengeReply(puzzle.id, state);
      assert.deepEqual(state, snapshot, 'searching for a defense cannot mutate the live board');
      const replies = legalActions(state);
      assert.ok(replies.some((action) => action.from === defender.from && action.to === defender.to));
      let canForce = replies.length > 0, minimum = Infinity, selectedWins;
      for (const response of replies) {
        const after = structuredClone(state); move(after, response.from, response.to);
        let finishes = 0;
        for (const finish of legalActions(after)) {
          const final = structuredClone(after); move(final, finish.from, finish.to);
          const won = findFive(final.board, 'red').length >= 5;
          assert.equal(challengeOutcome(puzzle.id, final), won ? 'solved' : 'failed', 'all legal final answers are checked by actual five-in-a-row');
          if (won) finishes++;
        }
        if (finishes > 1) multipleFinishes = true;
        if (!finishes) canForce = false;
        minimum = Math.min(minimum, finishes);
        if (response.from === defender.from && response.to === defender.to) selectedWins = finishes;
      }
      assert.equal(selectedWins, minimum, 'the defender chooses a reply with the fewest immediate red winning moves');
      if (canForce) forced.push([start.from, start.to]); else refutableStarts++;
    }
    assert.deepEqual(forced, expected[puzzle.id]);
    assert.ok(multipleFinishes, 'the exercise accepts alternative winning second moves');
    assert.ok(refutableStarts > 0, 'a poor first move has a real legal defensive refutation');
  }
  const cannon = createChallengeState('cannon-cross');
  move(cannon, 43, 40);
  assert.equal(cannon.history[0].captured.type, 'king');
  assert.equal(cannon.result, null, 'the opening king capture is still not a win');
  assert.equal(challengeOutcome('cannon-cross', cannon), 'playing');
});

test('growth is based on saved completion, recommendations stay open, invitations use only a known puzzle', () => {
  const progress = { 'rook-bridge': { stars: 2, attempts: 1 }, crossroads: { stars: 1, attempts: 4 } };
  assert.deepEqual(challengeMilestones(progress), { basics: 1, combos: 1, stars: 3 });
  assert.equal(recommendedChallenge(progress).id, 'horse-leg');
  const complete = Object.fromEntries(CHALLENGES.map((item) => [item.id, { stars: 2, attempts: 1 }]));
  complete['cannon-cross'].stars = 1;
  assert.equal(recommendedChallenge(complete).id, 'cannon-cross', 'a hinted completion remains available for an independent replay');
  assert.match(challengeInvitation('cannon-cross', true), /这题我解开了.*黑方会反击.*两手成五/);
  assert.match(challengeInvitation('break-threat'), /堵住落点/);
  assert.throws(() => challengeInvitation('unknown'));
  assert.equal(challengeFromUrl('https://example.org/games/xiangqi/?challenge=cannon-cross'), 'cannon-cross');
  assert.deepEqual(decodeChallengeProgress(JSON.stringify({ version: 1, progress })), progress, 'old progress remains intact beside new challenge IDs');
});

test('training teaches horse legs, elephant eyes, cannon screens and five rather than king capture', () => {
  const horse = createChallengeState('horse-leg');
  assert.equal(canMove(horse.board, 23, 40), false);
  const elephant = createChallengeState('elephant-eye');
  assert.equal(canMove(elephant.board, 23, 39), false);
  const cannon = createChallengeState('cannon-link');
  assert.equal(canMove(cannon.board, 2, 47), false);
  move(cannon, 46, 47);
  assert.equal(cannon.history[0].captured.type, 'king');
  assert.equal(cannon.result, null);
  assert.equal(challengeOutcome('cannon-link', cannon), 'failed');
  const defense = createChallengeState('break-threat');
  assert.equal(winningActions({ ...defense, turn: 'black' }, 'black').length, 1);
  move(defense, 67, 49);
  assert.equal(challengeOutcome('break-threat', defense), 'failed');
  assert.ok(winningActions(defense, 'black').some((action) => action.from === 13 && action.to === 49));
});

test('public challenge links accept only one known ID and remove all unrelated data', () => {
  assert.equal(challengeFromUrl('https://example.org/xiangqi/?challenge=horse-leg'), 'horse-leg');
  for (const query of ['challenge=unknown', 'challenge=../../x', 'challenge=horse-leg&challenge=cannon-link', 'challenge=%3Cscript%3E', 'state=%7B%7D']) assert.equal(challengeFromUrl(`https://example.org/?${query}`), null);
  assert.equal(challengeLink('https://user:pass@example.org/games/xiangqi/?server=secret&token=private#room=123', 'cannon-link'), 'https://example.org/games/xiangqi/?challenge=cannon-link');
  assert.throws(() => challengeLink('https://example.org/', '__proto__'));
  assert.throws(() => challengeLink('javascript:alert(1)', 'horse-leg'));
  assert.deepEqual(decodeChallengeProgress('broken'), {});
  assert.deepEqual(decodeChallengeProgress(JSON.stringify({ version: 1, progress: { 'horse-leg': { stars: 2, attempts: 3 }, 'cannon-link': { stars: 99, attempts: 1 }, arbitrary: { stars: 2, attempts: 1 } } })), { 'horse-leg': { stars: 2, attempts: 3 } });
});
