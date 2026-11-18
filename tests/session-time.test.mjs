// 场次中途上下线号的时长与计费计算。运行：node --experimental-strip-types --test tests/session-time.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import {
  accountEvents,
  accountHours,
  isAccountOnline,
  lastLeaveAt,
  markOffline,
  markOnline,
  resolveSpans,
  sessionDuration,
} from "../src/sessionTime.ts";

const H = 3_600_000;
const M = 60_000;
const T0 = Date.UTC(2026, 10, 18, 12);

function session(accounts, endAt = T0 + 2 * H) {
  return { id: "s", startAt: T0, endAt, accounts, pointsPerHour: 6, coinPerPoint: 30000, pointsOverride: null, drops: [], note: "" };
}
const acc = (id, spans) => (spans ? { id, name: id, spans } : { id, name: id });

test("旧数据（没有 spans）与原先 时长 × 号数 一致", () => {
  const s = session([acc("a"), acc("b"), acc("c")]);
  assert.equal(sessionDuration(s), 2 * H);
  assert.equal(accountHours(s), 6);
});

test("进行中的场次按 now 计算", () => {
  const s = session([acc("a"), acc("b")], null);
  assert.equal(sessionDuration(s, T0 + 30 * M), 30 * M);
  assert.equal(accountHours(s, T0 + 30 * M), 1);
  assert.equal(sessionDuration(s, T0 - M), 0, "now 早于上线不出现负数");
});

test("中途下线、再上线、加号", () => {
  const s = session(
    [
      acc("a"),
      acc("b", [{ from: null, to: T0 + 30 * M }, { from: T0 + H, to: null }]),
      acc("c", [{ from: T0 + H, to: null }]),
    ],
    T0 + 2 * H,
  );
  assert.equal(sessionDuration(s), 2 * H);
  // a 2h + b 0.5h + 1h + c 1h
  assert.equal(accountHours(s), 4.5);
  assert.deepEqual(accountEvents(s, s.accounts[1]), [
    { at: T0 + 30 * M, online: false },
    { at: T0 + H, online: true },
  ]);
  assert.deepEqual(accountEvents(s, s.accounts[2]), [{ at: T0 + H, online: true }]);
});

test("所有号都下线的时段不计入在线时长", () => {
  const s = session([
    acc("a", [{ from: null, to: T0 + 30 * M }, { from: T0 + 90 * M, to: null }]),
    acc("b", [{ from: null, to: T0 + 20 * M }]),
  ]);
  assert.equal(sessionDuration(s), 30 * M + 30 * M);
  assert.equal(accountHours(s), (30 + 30 + 20) / 60);
});

test("修改上下线时间后区间被夹取", () => {
  const s = session([acc("a", [{ from: T0 + 10 * M, to: T0 + 3 * H }]), acc("b", [{ from: T0 - H, to: T0 + 30 * M }])]);
  assert.deepEqual(resolveSpans(s, s.accounts[0]), [[T0 + 10 * M, T0 + 2 * H]]);
  assert.deepEqual(resolveSpans(s, s.accounts[1]), [[T0, T0 + 30 * M]]);
  // 下线时间改到某个号上线之前：该号不计时
  const early = { ...s, endAt: T0 + 5 * M };
  assert.deepEqual(resolveSpans(early, early.accounts[0]), []);
  assert.equal(sessionDuration(early), 5 * M);
});

test("markOffline / markOnline 与 lastLeaveAt", () => {
  const s = session([acc("a"), acc("b")], null);
  assert.equal(lastLeaveAt(s), null);
  markOffline(s.accounts[0], T0 + 10 * M);
  markOffline(s.accounts[0], T0 + 20 * M); // 已下线，重复调用无效
  assert.deepEqual(s.accounts[0].spans, [{ from: null, to: T0 + 10 * M }]);
  assert.equal(isAccountOnline(s.accounts[0]), false);
  markOffline(s.accounts[1], T0 + 40 * M);
  assert.equal(lastLeaveAt(s), T0 + 40 * M);
  markOnline(s.accounts[0], T0 + 50 * M);
  markOnline(s.accounts[0], T0 + 55 * M); // 已在线，重复调用无效
  assert.deepEqual(s.accounts[0].spans, [{ from: null, to: T0 + 10 * M }, { from: T0 + 50 * M, to: null }]);
  assert.equal(isAccountOnline(s.accounts[0]), true);
  assert.equal(lastLeaveAt(s), null);
  assert.equal(accountHours(s, T0 + H), (10 + 40 + 10) / 60);
});
