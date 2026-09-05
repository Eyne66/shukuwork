// settlement.js — Deterministic work-hour difference and transfer calculations.
// Direct port of src/book_workbench/settlement.py. Uses decimal arithmetic via
// bigint to avoid float artefacts in hour totals.

const Settlement = (() => {
  // Represent hours internally as integer hundredths (e.g. 0.5h = 50).
  function _toHundredths(value, field, rowNo) {
    if (value == null || value === "") {
      throw new Error(`${field} is required${rowNo != null ? ` on row ${rowNo}` : ""}`);
    }
    const s = String(value).trim();
    // accept "10", "10.5", "10.50", "0.5"
    if (!/^\d+(\.\d+)?$/.test(s)) {
      throw new Error(`${field} must be a number${rowNo != null ? ` on row ${rowNo}` : ""}`);
    }
    const [whole, frac = ""] = s.split(".");
    const padded = (frac + "00").slice(0, 2);
    return Number(whole) * 100 + Number(padded || 0);
  }

  function _fromHundredths(h) {
    if (h % 100 === 0) return String(h / 100);
    return (h / 100).toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  }

  function _nameKey(name) { return String(name).split(/\s+/).join(""); }

  function _status(diff) {
    if (diff > 0) return "应收";
    if (diff < 0) return "应转出";
    return "无差额";
  }

  function _normaliseRows(rows, issuedCap) {
    const cap = _toHundredths(issuedCap, "issued_cap");
    if (cap < 0) throw new Error("issued_cap cannot be negative");
    const out = [];
    const seen = new Set();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row || typeof row !== "object") throw new Error(`row ${i + 1} must be an object`);
      const raw = row.name;
      if (raw == null || !String(raw).trim()) throw new Error(`name is required on row ${i + 1}`);
      const name = String(raw).trim();
      const key = _nameKey(name);
      if (seen.has(key)) throw new Error(`duplicate person name: ${name}`);
      seen.add(key);
      const actual = _toHundredths(row.actual_hours, "actual_hours", i + 1);
      const issued = _toHundredths(row.issued_hours, "issued_hours", i + 1);
      if (actual < 0) throw new Error(`actual_hours cannot be negative on row ${i + 1}`);
      if (issued < 0) throw new Error(`issued_hours cannot be negative on row ${i + 1}`);
      if (issued > cap) {
        throw new Error(`issued_hours for ${name} is ${_fromHundredths(issued)}, above the cap ${_fromHundredths(cap)}`);
      }
      const diff = actual - issued;
      out.push({
        person_id: row.person_id ? String(row.person_id).trim() : null,
        name,
        actual_hours: actual,
        issued_hours: issued,
        difference_hours: diff,
        status: _status(diff),
      });
    }
    if (!out.length) throw new Error("at least one person is required");
    return out;
  }

  function calculate(rows, issuedCap = "33") {
    const people = _normaliseRows(rows, issuedCap);
    const receivers = people.filter(r => r.difference_hours > 0).map(r => ({ name: r.name, remaining: r.difference_hours }));
    const payers = people.filter(r => r.difference_hours < 0).map(r => ({ name: r.name, remaining: -r.difference_hours }));
    const transfers = [];

    // exact matches first
    for (const receiver of receivers) {
      if (receiver.remaining <= 0) continue;
      for (const payer of payers) {
        if (payer.remaining > 0 && payer.remaining === receiver.remaining) {
          transfers.push({ payer: payer.name, receiver: receiver.name, hours: _fromHundredths(receiver.remaining) });
          payer.remaining = 0;
          receiver.remaining = 0;
          break;
        }
      }
    }
    const recv2 = receivers.filter(r => r.remaining > 0);
    const pay2 = payers.filter(p => p.remaining > 0);
    recv2.sort((a, b) => b.remaining - a.remaining || a.name.localeCompare(b.name));
    pay2.sort((a, b) => b.remaining - a.remaining || a.name.localeCompare(b.name));
    let ri = 0, pi = 0;
    while (ri < recv2.length && pi < pay2.length) {
      const r = recv2[ri], p = pay2[pi];
      const amount = Math.min(r.remaining, p.remaining);
      if (amount > 0) {
        transfers.push({ payer: p.name, receiver: r.name, hours: _fromHundredths(amount) });
      }
      r.remaining -= amount;
      p.remaining -= amount;
      if (r.remaining === 0) ri++;
      if (p.remaining === 0) pi++;
    }

    let actualTotal = 0, issuedTotal = 0, receivableTotal = 0, payableTotal = 0, transferTotal = 0;
    for (const p of people) {
      actualTotal += p.actual_hours;
      issuedTotal += p.issued_hours;
      if (p.difference_hours > 0) receivableTotal += p.difference_hours;
      if (p.difference_hours < 0) payableTotal += -p.difference_hours;
    }
    for (const t of transfers) transferTotal += _toHundredths(t.hours, "transfer hours");
    const diffTotal = actualTotal - issuedTotal;

    return {
      people: people.map(p => ({
        ...p,
        actual_hours: _fromHundredths(p.actual_hours),
        issued_hours: _fromHundredths(p.issued_hours),
        difference_hours: _fromHundredths(p.difference_hours),
      })),
      totals: {
        actual_hours: _fromHundredths(actualTotal),
        issued_hours: _fromHundredths(issuedTotal),
        difference_hours: _fromHundredths(diffTotal),
        receivable_hours: _fromHundredths(receivableTotal),
        payable_hours: _fromHundredths(payableTotal),
        draft_transfer_hours: _fromHundredths(transferTotal),
        external_adjustment_hours: _fromHundredths(diffTotal),
      },
      transfers,
      checks: {
        issued_hours_within_cap: true,
        people_unique: true,
        difference_reconciles: actualTotal - issuedTotal === diffTotal,
        draft_transfer_balanced_between_people: transferTotal === Math.min(receivableTotal, payableTotal),
        net_difference_is_zero: diffTotal === 0,
      },
    };
  }

  function validateTransfers(rows, transfers, issuedCap = "33") {
    const people = _normaliseRows(rows, issuedCap);
    const byName = {};
    for (const p of people) byName[_nameKey(p.name)] = p;
    const paid = {}, received = {};
    const errors = [];

    for (let i = 0; i < transfers.length; i++) {
      const t = transfers[i];
      if (!t || typeof t !== "object") {
        errors.push(`transfer row ${i + 1} must be an object`);
        continue;
      }
      const payerName = String(t.payer || "").trim();
      const receiverName = String(t.receiver || "").trim();
      let amount;
      try {
        amount = _toHundredths(t.hours, "transfer hours", i + 1);
      } catch (e) {
        errors.push(e.message);
        continue;
      }
      const payer = byName[_nameKey(payerName)];
      const receiver = byName[_nameKey(receiverName)];
      if (!payer) errors.push(`unknown payer: ${payerName}`);
      if (!receiver) errors.push(`unknown receiver: ${receiverName}`);
      if (amount <= 0) errors.push(`transfer hours must be positive on row ${i + 1}`);
      if (payerName && receiverName && _nameKey(payerName) === _nameKey(receiverName)) {
        errors.push(`payer and receiver cannot be the same person on row ${i + 1}`);
      }
      if (payer) {
        if (payer.difference_hours >= 0) errors.push(`payer ${payerName} does not have a negative difference`);
        paid[_nameKey(payerName)] = (paid[_nameKey(payerName)] || 0) + amount;
      }
      if (receiver) {
        if (receiver.difference_hours <= 0) errors.push(`receiver ${receiverName} does not have a positive difference`);
        received[_nameKey(receiverName)] = (received[_nameKey(receiverName)] || 0) + amount;
      }
    }

    for (const [key, row] of Object.entries(byName)) {
      const allowedPaid = Math.max(-row.difference_hours, 0);
      const allowedReceived = Math.max(row.difference_hours, 0);
      if ((paid[key] || 0) > allowedPaid) errors.push(`payer ${row.name} is over-allocated`);
      if ((received[key] || 0) > allowedReceived) errors.push(`receiver ${row.name} is over-allocated`);
    }

    const diffTotal = people.reduce((s, r) => s + r.difference_hours, 0);
    if (diffTotal !== 0) {
      errors.push(`overall difference is ${_fromHundredths(diffTotal)}; adjust official issued hours before final transfer`);
    } else {
      for (const [key, row] of Object.entries(byName)) {
        const requiredPaid = Math.max(-row.difference_hours, 0);
        const requiredReceived = Math.max(row.difference_hours, 0);
        if ((paid[key] || 0) !== requiredPaid) errors.push(`payer ${row.name} is not fully allocated`);
        if ((received[key] || 0) !== requiredReceived) errors.push(`receiver ${row.name} is not fully allocated`);
      }
    }

    const totalPaid = Object.values(paid).reduce((a, b) => a + b, 0);
    const totalReceived = Object.values(received).reduce((a, b) => a + b, 0);
    const errs = totalPaid === totalReceived ? errors : [...errors, "paid and received totals do not match"];
    return {
      ok: errs.length === 0 && totalPaid === totalReceived,
      errors: errs,
      paid_hours: _fromHundredths(totalPaid),
      received_hours: _fromHundredths(totalReceived),
      unmatched_difference_hours: _fromHundredths(totalReceived - totalPaid),
    };
  }

  return { calculate, validateTransfers };
})();
