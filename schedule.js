// schedule.js — Deterministic validation and generation for a weekly schedule.
// Direct port of src/book_workbench/schedule.py. Same algorithm, same semantics.

const Schedule = (() => {
  function _hours(value, field) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error(`${field} must be a non-negative number`);
    }
    return n;
  }

  function _renderHours(n) {
    return Number.isInteger(n) ? String(n) : String(n);
  }

  function _normaliseName(value, field = "name") {
    if (value == null || !String(value).trim()) {
      throw new Error(`${field} is required`);
    }
    return String(value).trim();
  }

  function _identityName(value) {
    return String(value).split(/\s+/).join("");
  }

  function _parseDate(value, field) {
    const s = String(value);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) throw new Error(`${field} must use YYYY-MM-DD`);
    const y = Number(m[1]), mo = Number(m[2]) - 1, d = Number(m[3]);
    const dt = new Date(Date.UTC(y, mo, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo || dt.getUTCDate() !== d) {
      throw new Error(`${field} must use YYYY-MM-DD`);
    }
    return dt;
  }

  function _isoDate(dt) {
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
  }

  function _key(day, shiftId) {
    return `${day}|${shiftId}`;
  }

  function _daysBetween(start, end) {
    const days = [];
    const cur = new Date(start);
    while (cur <= end) {
      days.push(_isoDate(cur));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return days;
  }

  function validate(payload) {
    if (!payload || typeof payload !== "object") {
      throw new Error("schedule input must be an object");
    }
    const cycle = payload.cycle || {};
    const start = _parseDate(cycle.start_date, "cycle.start_date");
    const end = _parseDate(cycle.end_date, "cycle.end_date");
    if (end < start) {
      throw new Error("cycle.end_date cannot be before start_date");
    }

    const people = payload.people;
    if (!Array.isArray(people) || !people.length) {
      throw new Error("people must be a non-empty list");
    }
    const roster = {};
    for (let i = 0; i < people.length; i++) {
      const p = people[i];
      if (!p || typeof p !== "object") {
        throw new Error(`people row ${i + 1} must be an object`);
      }
      const name = _normaliseName(p.name, `people[${i + 1}].name`);
      const identity = _identityName(name);
      if (roster[identity]) {
        throw new Error(`duplicate person name: ${name}`);
      }
      const unavailable = new Set();
      for (const item of p.unavailable || []) {
        unavailable.add(_key(String(item.date), String(item.shift_id)));
      }
      roster[identity] = { name, unavailable };
    }

    const shifts = payload.shifts;
    if (!Array.isArray(shifts) || !shifts.length) {
      throw new Error("shifts must be a non-empty list");
    }
    const shiftMap = {};
    for (let i = 0; i < shifts.length; i++) {
      const s = shifts[i];
      if (!s || typeof s !== "object") {
        throw new Error(`shifts row ${i + 1} must be an object`);
      }
      const id = _normaliseName(s.id, `shifts[${i + 1}].id`);
      if (shiftMap[id]) {
        throw new Error(`duplicate shift id: ${id}`);
      }
      const required = s.required_people;
      if (!Number.isInteger(required) || required < 0) {
        throw new Error(`required_people must be a non-negative integer for ${id}`);
      }
      if (s.duration_hours == null) {
        throw new Error(`duration_hours is required for ${id}`);
      }
      shiftMap[id] = {
        id,
        name: String(s.name || id),
        duration_hours: _hours(s.duration_hours, `duration_hours for ${id}`),
        required_people: required,
      };
    }

    let dayValues;
    if (payload.days == null) {
      dayValues = _daysBetween(start, end);
    } else {
      if (!Array.isArray(payload.days) || !payload.days.length) {
        throw new Error("days must be a non-empty list");
      }
      dayValues = [];
      for (let i = 0; i < payload.days.length; i++) {
        const item = payload.days[i];
        const raw = typeof item === "object" ? item.date : item;
        const parsed = _parseDate(raw, `days[${i + 1}].date`);
        if (parsed < start || parsed > end) {
          throw new Error(`day ${_isoDate(parsed)} is outside the cycle`);
        }
        dayValues.push(_isoDate(parsed));
      }
    }
    if (new Set(dayValues).size !== dayValues.length) {
      throw new Error("duplicate day");
    }

    for (const person of Object.values(roster)) {
      for (const key of person.unavailable) {
        const [day, shiftId] = key.split("|");
        if (!dayValues.includes(day)) {
          throw new Error(`unavailable date for ${person.name} is outside the cycle: ${day}`);
        }
        if (!shiftMap[shiftId]) {
          throw new Error(`unknown unavailable shift for ${person.name}: ${shiftId}`);
        }
      }
    }

    const rawDayReq = payload.day_requirements || {};
    if (typeof rawDayReq !== "object" || Array.isArray(rawDayReq)) {
      throw new Error("day_requirements must be an object");
    }
    const dayRequirements = {};
    for (const [rawDay, overrides] of Object.entries(rawDayReq)) {
      const parsedDay = _isoDate(_parseDate(rawDay, "day_requirements date"));
      if (!dayValues.includes(parsedDay)) {
        throw new Error(`day_requirements date ${parsedDay} is not a declared day`);
      }
      if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
        throw new Error(`day_requirements for ${parsedDay} must be an object`);
      }
      dayRequirements[parsedDay] = {};
      for (const [shiftId, required] of Object.entries(overrides)) {
        if (!shiftMap[shiftId]) {
          throw new Error(`unknown shift in day_requirements: ${shiftId}`);
        }
        if (!Number.isInteger(required) || required < 0) {
          throw new Error(`day_requirements must be non-negative integers for ${parsedDay}/${shiftId}`);
        }
        dayRequirements[parsedDay][shiftId] = required;
      }
    }

    const assignments = Array.isArray(payload.assignments) ? payload.assignments : [];
    const assignmentMap = {};
    const errors = [];
    const warnings = [];
    for (let i = 0; i < assignments.length; i++) {
      const a = assignments[i];
      if (!a || typeof a !== "object") {
        errors.push(`assignment row ${i + 1} must be an object`);
        continue;
      }
      const day = String(a.date);
      const shiftId = String(a.shift_id);
      try {
        const parsed = _parseDate(day, `assignments[${i + 1}].date`);
        if (!dayValues.includes(day) || parsed < start || parsed > end) {
          errors.push(`assignment row ${i + 1} is outside the cycle or declared days`);
        }
      } catch (e) {
        errors.push(e.message);
        continue;
      }
      if (!shiftMap[shiftId]) {
        errors.push(`unknown shift: ${shiftId}`);
      }
      const list = Array.isArray(a.people) ? a.people : (errors.push(`assignment row ${i + 1}.people must be a list`), []);
      const key = _key(day, shiftId);
      if (!assignmentMap[key]) assignmentMap[key] = [];
      for (const p of list) assignmentMap[key].push(String(p).trim());
    }

    const shiftResults = [];
    const personHours = {};
    const personShiftCounts = {};
    let plannedSlots = 0, filledSlots = 0;
    let plannedHours = 0, filledHours = 0;

    for (const day of dayValues) {
      for (const [shiftId, shift] of Object.entries(shiftMap)) {
        const assigned = assignmentMap[`${day}|${shiftId}`] || [];
        const counts = {};
        for (const n of assigned) counts[n] = (counts[n] || 0) + 1;
        const duplicates = Object.keys(counts).filter(k => counts[k] > 1).sort();
        const unknown = Object.keys(counts).filter(k => !roster[_identityName(k)]).sort();
        const unavailable = Object.keys(counts).filter(k => {
          const id = _identityName(k);
          return roster[id] && roster[id].unavailable.has(`${day}|${shiftId}`);
        }).sort();
        if (duplicates.length) errors.push(`duplicate person in ${day}/${shiftId}: ${duplicates.join(", ")}`);
        if (unknown.length) errors.push(`unknown person in ${day}/${shiftId}: ${unknown.join(", ")}`);
        if (unavailable.length) errors.push(`unavailable person assigned in ${day}/${shiftId}: ${unavailable.join(", ")}`);

        const required = (dayRequirements[day] && dayRequirements[day][shiftId] != null)
          ? dayRequirements[day][shiftId]
          : shift.required_people;
        const actualCount = assigned.length;
        const vacancy = Math.max(required - actualCount, 0);
        const excess = Math.max(actualCount - required, 0);
        if (vacancy) warnings.push(`${day}/${shiftId} has ${vacancy} vacancy`);
        if (excess) errors.push(`${day}/${shiftId} has ${excess} excess assignment(s)`);

        plannedSlots += required;
        filledSlots += actualCount;
        plannedHours += shift.duration_hours * required;
        filledHours += shift.duration_hours * actualCount;

        for (const name of assigned) {
          const id = _identityName(name);
          if (!roster[id]) continue;
          const canonical = roster[id].name;
          personHours[canonical] = (personHours[canonical] || 0) + shift.duration_hours;
          if (!personShiftCounts[canonical]) personShiftCounts[canonical] = {};
          personShiftCounts[canonical][shiftId] = (personShiftCounts[canonical][shiftId] || 0) + 1;
        }
        shiftResults.push({
          date: day,
          shift_id: shiftId,
          shift_name: shift.name,
          required_people: required,
          assigned_people: assigned,
          assigned_count: actualCount,
          vacancy_count: vacancy,
          excess_count: excess,
          duplicates,
          unknown_people: unknown,
          unavailable_people: unavailable,
        });
      }
    }

    const peopleSummary = Object.values(roster).map(p => ({
      name: p.name,
      morning_or_shift_counts: personShiftCounts[p.name] || {},
      assigned_hours: _renderHours(personHours[p.name] || 0),
    }));

    return {
      ok: errors.length === 0,
      errors,
      warnings,
      shift_results: shiftResults,
      people: peopleSummary,
      totals: {
        planned_slots: plannedSlots,
        filled_slots: filledSlots,
        vacancy_slots: Math.max(plannedSlots - filledSlots, 0),
        planned_hours: _renderHours(plannedHours),
        filled_hours: _renderHours(filledHours),
      },
    };
  }

  function generate(payload) {
    if (!payload || typeof payload !== "object") {
      throw new Error("schedule input must be an object");
    }
    const allocationMode = payload.allocation_mode || "total_hours";
    if (!["total_hours", "by_duration"].includes(allocationMode)) {
      throw new Error("allocation_mode must be total_hours or by_duration");
    }
    const base = { ...payload, assignments: [] };
    validate(base);  // throws if invalid

    const start = _parseDate(payload.cycle.start_date, "cycle.start_date");
    const end = _parseDate(payload.cycle.end_date, "cycle.end_date");
    const dayValues = payload.days
      ? payload.days.map(d => _isoDate(_parseDate(typeof d === "object" ? d.date : d, "day.date")))
      : _daysBetween(start, end);
    const dayRequirements = payload.day_requirements || {};

    function requiredFor(day, shiftId, defaultVal) {
      return (dayRequirements[day] && dayRequirements[day][shiftId] != null)
        ? dayRequirements[day][shiftId]
        : defaultVal;
    }

    const roster = {};
    for (const p of payload.people) {
      const name = _normaliseName(p.name);
      const identity = _identityName(name);
      const unavailable = new Set();
      const preferred = new Set();
      for (const item of p.unavailable || []) unavailable.add(_key(String(item.date), String(item.shift_id)));
      for (const item of p.preferred || []) preferred.add(_key(String(item.date), String(item.shift_id)));
      let target = p.target_hours != null
        ? p.target_hours
        : (payload.target_hours && payload.target_hours[name] != null ? payload.target_hours[name] : null);
      if (target != null) target = _hours(target, `target_hours for ${name}`);
      roster[identity] = { name, unavailable, preferred, target };
    }

    const shiftMap = {};
    for (const s of payload.shifts) {
      const id = _normaliseName(s.id);
      shiftMap[id] = {
        id,
        duration: _hours(s.duration_hours, `duration_hours for ${id}`),
        required: Number(s.required_people || 0),
      };
    }

    let planned = 0;
    for (const day of dayValues) {
      for (const shift of Object.values(shiftMap)) {
        planned += shift.duration * requiredFor(day, shift.id, shift.required);
    }
    }
    const defaultTarget = Object.keys(roster).length ? planned / Object.keys(roster).length : 0;
    for (const r of Object.values(roster)) {
      if (r.target == null) r.target = defaultTarget;
    }

    const durationTargets = {};
    if (allocationMode === "by_duration") {
      const durationTotals = {};
      for (const day of dayValues) {
        for (const shift of Object.values(shiftMap)) {
          durationTotals[shift.duration] = (durationTotals[shift.duration] || 0) +
            shift.duration * requiredFor(day, shift.id, shift.required);
        }
      }
      const n = Object.keys(roster).length || 1;
      for (const [d, t] of Object.entries(durationTotals)) durationTargets[d] = t / n;
    }

    const currentHours = {};
    const durationHours = {};
    const assignments = [];
    for (const day of dayValues) {
      const ordered = Object.values(shiftMap).sort((a, b) => {
        const aAvail = Object.values(roster).filter(r => !r.unavailable.has(_key(day, a.id))).length;
        const bAvail = Object.values(roster).filter(r => !r.unavailable.has(_key(day, b.id))).length;
        return aAvail - bAvail || a.id.localeCompare(b.id);
      });
      for (const shift of ordered) {
        const required = requiredFor(day, shift.id, shift.required);
        const candidates = [];
        for (const r of Object.values(roster)) {
          if (r.unavailable.has(_key(day, shift.id))) continue;
          const bonus = r.preferred.has(_key(day, shift.id)) ? 0.25 : 0;
          const target = r.target || 0;
          const have = currentHours[r.name] || 0;
          const overallRatio = target > 0 ? have / target : 1000000 + have;
          let score, balanceHours;
          if (allocationMode === "by_duration") {
            const durTarget = durationTargets[shift.duration] || 0;
            const durHave = (durationHours[shift.duration] && durationHours[shift.duration][r.name]) || 0;
            const durRatio = durTarget > 0 ? durHave / durTarget : 0;
            score = durRatio + overallRatio * 0.05 - bonus;
            balanceHours = durHave;
          } else {
            score = overallRatio - bonus;
            balanceHours = have;
          }
          candidates.push({ score, balance: balanceHours, have, name: r.name });
        }
        candidates.sort((a, b) => a.score - b.score || a.balance - b.balance || a.have - b.have || a.name.localeCompare(b.name));
        const chosen = candidates.slice(0, required).map(c => c.name);
        for (const name of chosen) {
          currentHours[name] = (currentHours[name] || 0) + shift.duration;
          if (allocationMode === "by_duration") {
            if (!durationHours[shift.duration]) durationHours[shift.duration] = {};
            durationHours[shift.duration][name] = (durationHours[shift.duration][name] || 0) + shift.duration;
          }
        }
        assignments.push({ date: day, shift_id: shift.id, people: chosen });
      }
    }
    const generated = { ...payload, assignments };
    return { schedule: generated, validation: validate(generated) };
  }

  return { validate, generate };
})();
