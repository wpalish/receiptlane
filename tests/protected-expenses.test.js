import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import definition from "../module.js";
import { WorkStore } from "../core/store.js";

test("protected report expenses retain source and destination totals across moves, restart and restore", () => {
  const employee = { name: "synthetic-requester", role: "operator" };
  const admin = { name: "synthetic-approver", role: "admin" };
  for (const status of ["submitted", "approved", "reimbursed"]) {
    const folder = mkdtempSync(join(tmpdir(), "receiptlane-protected-"));
    const path = join(folder, "workspace.sqlite");
    let store = new WorkStore(definition, path);
    const save = (collection, data, id, actor = employee) => {
      const next = store.transact({ operation: "save", collection, data, id,
        revision: store.read().revision }, actor);
      return id || next.data[collection].at(-1).id;
    };
    const events = (target) => target.db.prepare("SELECT * FROM audit ORDER BY rowid").all();
    const reject = (target, command) => {
      const before = target.read(), audit = events(target);
      assert.throws(() => target.transact({ ...command, revision: before.revision }, admin), /черновик/);
      assert.deepEqual(target.read(), before, "All records, both totals and revision are unchanged");
      assert.deepEqual(events(target), audit, "Rejected edit leaves audit history unchanged");
    };
    try {
      const report = (name, state = "draft") => ({ name, currency: "KZT", period: "2026-10-25", status: state });
      const sourceData = report("SYNTHETIC source"), destinationData = report("SYNTHETIC draft");
      const source = save("reports", sourceData), destination = save("reports", destinationData);
      const expense = (parent, vendor, amount = "100") => ({ report: parent, vendor,
        date: "2026-10-25", amount, evidence: "SYNTHETIC receipt TEST" });
      const firstData = expense(source, "SYNTHETIC protected expense");
      const first = save("expenses", firstData);
      save("expenses", expense(source, "SYNTHETIC second expense"));
      const freeData = expense(destination, "SYNTHETIC draft expense", "50");
      const free = save("expenses", freeData);
      // Both draft reports permit corrections and relocation before submission.
      save("expenses", { ...freeData, report: source }, free);
      save("expenses", freeData, free);
      save("reports", { ...sourceData, status: "submitted" }, source);
      if (["approved", "reimbursed"].includes(status))
        save("reports", { ...sourceData, status: "approved" }, source, admin);
      if (status === "reimbursed")
        save("reports", { ...sourceData, status: "reimbursed" }, source, admin);
      const beforeRestart = store.read(), beforeAudit = events(store);
      store.close(); store = new WorkStore(definition, path);
      assert.deepEqual(store.read(), beforeRestart);
      assert.deepEqual(events(store), beforeAudit);
      const relocation = { operation: "save", collection: "expenses", id: first,
        data: { ...firstData, report: destination } };
      reject(store, relocation);
      reject(store, { ...relocation, data: { ...relocation.data, amount: "1", evidence: "SYNTHETIC altered" } });
      reject(store, { ...relocation, data: { ...firstData, amount: "1" } });
      reject(store, { operation: "archive", collection: "expenses", id: first });
      reject(store, { operation: "save", collection: "expenses", id: free,
        data: { ...freeData, report: source } });
      const restored = new WorkStore(definition);
      try {
        restored.restore(store.export());
        assert.deepEqual(restored.read().data, store.read().data);
        assert.deepEqual(restored.read().computed, store.read().computed);
        reject(restored, relocation);
      } finally { restored.close(); }
      if (status !== "reimbursed") {
        save("reports", sourceData, source);
        save("expenses", relocation.data, first);
        assert.equal(store.read().data.expenses.find((x) => x.id === first).report, destination,
          "Explicit permitted return to draft restores editing");
      } else {
        const before = store.read();
        assert.throws(() => save("reports", sourceData, source, admin), /нельзя менять|сохраняется/);
        assert.deepEqual(store.read(), before);
      }
    } finally {
      store.close(); rmSync(folder, { recursive: true, force: true });
    }
  }
});
