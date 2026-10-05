/**
 * Spectrum Credit Limited — Logbook Loan Calculator
 * Flat-interest schedule, weekly penalty rolls, demand fees, receipts, and client statement.
 */
(function () {
  const $ = (id) => document.getElementById(id);

  const state = {
    tab: "ontime",
    payments: [],
    nextPayId: 1,
    demandFees: [],
    nextDemandId: 1,
    hydrating: false,
    example: "",
    accountNumber: "",
    lmsStatus: "",
    releaseDoc: "certificate",
  };

  const RELEASE_STEPS = [
    { n: 1, key: "reconcile", short: "Reconcile", title: "Auto payment reconciliation", detail: "Final M-Pesa / bank receipt matched to outstanding. No reversed transactions. Account marked Paid in Full." },
    { n: 2, key: "review", short: "Closure Review", title: "Loan closure verification", detail: "Finance/Operations confirm payments cleared, no chargebacks, no duplicate balances, and customer identity. Pending Closure Review → Approved for Release." },
    { n: 3, key: "documents", short: "Documents", title: "Auto-generate clearance documents", detail: "Loan Clearance Certificate, Final Statement, Logbook Release Letter, and Account Closure Confirmation." },
    { n: 4, key: "notify_teams", short: "Notify Teams", title: "Notify internal teams", detail: "Operations, custody/document team, branch manager, and collections (follow-ups stop)." },
    { n: 5, key: "notify_customer", short: "Notify Client", title: "Customer notification", detail: "Your loan has been fully repaid. Your logbook is ready for release. Please visit branch with your ID for collection." },
    { n: 6, key: "appointment", short: "Appointment", title: "Logbook release appointment", detail: "Customer books branch pickup. Courier delivery is a future option." },
    { n: 7, key: "handover", short: "Handover", title: "Physical document handover", detail: "Staff verifies National ID, signed release forms, and customer acknowledgement receipt." },
    { n: 8, key: "closed", short: "Released", title: "CLOSED → LOGBOOK RELEASED", detail: "System stores release date, receiving customer, staff handling release, and signed acknowledgement." }
  ];

  function parseISODate(iso) {
    if (!iso) return null;
    const parts = String(iso).slice(0, 10).split("-").map(Number);
    if (parts.length !== 3 || parts.some(function (n) { return !n; })) return null;
    const date = new Date(parts[0], parts[1] - 1, parts[2]);
    if (isNaN(date.getTime())) return null;
    return date;
  }

  function toISODate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + d;
  }

  function formatDate(date) {
    const d = String(date.getDate()).padStart(2, "0");
    const m = String(date.getMonth() + 1).padStart(2, "0");
    return d + "/" + m + "/" + date.getFullYear();
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function addDays(date, days) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  }

  function addMonths(date, months) {
    const y = date.getFullYear();
    const m = date.getMonth() + months;
    const day = date.getDate();
    const result = new Date(y, m, day);
    if (result.getDate() !== day) {
      return new Date(y, m + 1, 0);
    }
    return result;
  }

  function cmpDate(a, b) {
    return startOfDay(a) - startOfDay(b);
  }

  function withCommas(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function money(n, currency) {
    const rounded = Math.round(n);
    const formatted = withCommas(Math.abs(rounded));
    const sign = rounded < 0 ? "-" : "";
    return currency ? sign + currency + " " + formatted : sign + formatted;
  }

  function moneyPrecise(n, currency) {
    const v = Number(n) || 0;
    const sign = v < 0 ? "-" : "";
    const cleaned = Math.round(Math.abs(v) * 1e8) / 1e8;
    const parts = cleaned.toFixed(8).split(".");
    const intPart = withCommas(Number(parts[0]));
    const fracPart = (parts[1] || "").replace(/0+$/, "");
    const formatted = fracPart ? intPart + "." + fracPart : intPart;
    return currency ? sign + currency + " " + formatted : sign + formatted;
  }

  function moneyFixed(n, currency) {
    return moneyPrecise(n, currency);
  }

  function formatPct(rate) {
    const pct = rate * 100;
    return pct % 1 === 0 ? String(pct) : pct.toFixed(2);
  }

  function formatStatementDate(date) {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const d = String(date.getDate()).padStart(2, "0");
    return d + "-" + months[date.getMonth()] + "-" + String(date.getFullYear()).slice(-2);
  }

  function formatLedgerDate(date) {
    return String(date.getDate()).padStart(2, "0") + "/" +
      String(date.getMonth() + 1).padStart(2, "0") + "/" + date.getFullYear();
  }

  function statementAmount(value) {
    return (Number(value) || 0).toLocaleString("en-KE", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function digitsOnly(value) {
    return String(value || "").replace(/[^\d]/g, "");
  }

  function formatAmountValue(value) {
    const digits = digitsOnly(value);
    return digits ? withCommas(Number(digits)) : "";
  }

  function parseAmount(value) {
    const raw = String(value || "").replace(/,/g, "").trim();
    if (raw === "") return NaN;
    return Number(raw);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function readNumber(id) {
    const el = $(id);
    if (!el) return NaN;
    return parseAmount(el.value);
  }

  function persist() {
    if (state.hydrating) return;
    try {
      localStorage.setItem("spectrum-logbook-loan", JSON.stringify(snapshot()));
    } catch (err) {}
  }

  function readSaved() {
    try {
      const next = JSON.parse(localStorage.getItem("spectrum-logbook-loan") || "null");
      if (next) return next;
      return JSON.parse(localStorage.getItem("davie-logbook-loan") || "null");
    } catch (err) {
      return null;
    }
  }

  function snapshot() {
    return {
      v: 1,
      clientName: $("clientName").value.trim(),
      logbookRef: $("logbookRef").value.trim(),
      currency: $("currency").value.trim(),
      principal: digitsOnly($("principal").value),
      tenure: $("tenure").value,
      rate: $("rate").value,
      trackingFee: digitsOnly($("trackingFee").value),
      penaltyRate: $("penaltyRate").value,
      graceDays: $("graceDays").value,
      disbursement: $("disbursement").value,
      firstDue: $("firstDue") ? $("firstDue").value : "",
      asOf: $("asOf").value,
      tab: state.tab,
      example: state.example || "",
      accountNumber: state.accountNumber || "",
      lmsStatus: state.lmsStatus || "",
      releaseDoc: state.releaseDoc || "certificate",
      payments: state.payments.map(function (p) {
        return {
          n: p.n,
          date: p.date ? toISODate(p.date) : "",
          amount: p.amount,
          ref: p.ref || "",
        };
      }),
      demandFees: state.demandFees.map(function (d) {
        return {
          date: d.date ? toISODate(d.date) : "",
          amount: d.amount,
          ref: d.ref || "",
        };
      }),
    };
  }

  function applySnapshot(data) {
    if (!data) return false;
    state.hydrating = true;
    $("clientName").value = data.clientName || "";
    $("logbookRef").value = data.logbookRef || "";
    $("currency").value = data.currency || "KES";
    $("principal").value = formatAmountValue(data.principal);
    $("tenure").value = data.tenure || "";
    $("rate").value = data.rate || "";
    $("trackingFee").value = formatAmountValue(data.trackingFee);
    $("penaltyRate").value = data.penaltyRate || "5";
    $("graceDays").value = data.graceDays || "7";
    $("disbursement").value = data.disbursement || "";
    if ($("firstDue")) {
      $("firstDue").value = data.firstDue || "";
      if (!$("firstDue").value && data.disbursement) {
        const disb = parseISODate(data.disbursement);
        if (disb) $("firstDue").value = toISODate(FinEngine.firstOfNextMonth(disb));
      }
    }
    $("asOf").value = data.asOf || "";
    state.payments = [];
    state.nextPayId = 1;
    state.demandFees = [];
    state.nextDemandId = 1;
    (data.payments || []).forEach(function (p) {
      const date = parseISODate(p.date);
      if (!date || !(p.amount > 0)) return;
      addPayment(Number(p.n) || 1, date, p.amount, p.ref);
    });
    (data.demandFees || []).forEach(function (d) {
      const date = parseISODate(d.date);
      if (!date || !(d.amount > 0)) return;
      addDemandFee(date, d.amount, d.ref);
    });
    if (data.tab) state.tab = data.tab;
    state.example = data.example || "";
    state.accountNumber = data.accountNumber || "";
    state.lmsStatus = data.lmsStatus || "";
    if (data.releaseDoc) state.releaseDoc = data.releaseDoc;
    markExampleButtons();
    state.hydrating = false;
    return true;
  }

  function markExampleButtons() {
    document.querySelectorAll("#calc-examples .calc-example").forEach(function (btn) {
      btn.classList.toggle("is-active", btn.getAttribute("data-example") === state.example);
    });
  }

  function sampleLoanTerms() {
    return {
      clientName: "Example client",
      logbookRef: "KES 3,000,000 · 24 months",
      currency: "KES",
      principal: "3000000",
      tenure: "24",
      rate: "4",
      trackingFee: "3000",
      penaltyRate: "5",
      graceDays: "7",
      disbursement: "2025-11-20",
      firstDue: "2025-12-20",
    };
  }

  function onTimeReceipts(quote) {
    return (quote.schedule || []).map(function (row) {
      return { n: row.n, date: row.dueDate, amount: row.installment, ref: "ON-TIME #" + row.n };
    });
  }

  function loadExample(name) {
    if (!canViewScheduleServicing()) return denyScheduleAccess();
    if (!$("loanForm")) return false;
    const terms = sampleLoanTerms();
    const quote = FinEngine.quoteLogbookFlat(
      3000000, 4, 24, 3000, terms.disbursement, terms.firstDue
    );
    const rolledQuote = FinEngine.quoteLogbookFlat(
      3000000, 4.1, 24, 0, "2026-08-02", "2026-09-01"
    );

    const examples = {
      missed: {
        note: "Case 1 — client missed 20/12/2025. After 7 days: 248,000 × 5% = 12,400, then weekly compounding to 10/01/2026 = 287,091.",
        tab: "arrears",
        asOf: "2026-01-10",
        payments: [],
      },
      late: {
        note: "Case 2 — paid 260,400 on 28/12/2025 (248,000 installment + 12,400 penalty). Installment is PAID; further penalties stop.",
        tab: "arrears",
        asOf: "2025-12-28",
        payments: [{ n: 1, date: "2025-12-28", amount: 260400, ref: "LATE CLEARANCE" }],
      },
      partial: {
        note: "Case 3 — paid 150,000 on due date. Outstanding installment 98,000; applicable penalty 98,000 × 5% = 4,900. Weekly rules continue on the remainder.",
        tab: "arrears",
        asOf: "2025-12-27",
        payments: [{ n: 1, date: "2025-12-20", amount: 150000, ref: "PARTIAL 150,000" }],
      },
      ontime: {
        note: "Case 4 — every installment paid on the due date. Outstanding total balance = remaining principal + remaining interest + remaining tracking. Loan COMPLETED / CLOSED.",
        tab: "ontime",
        asOf: "2027-11-20",
        payments: quote ? onTimeReceipts(quote) : [],
      },
      release: {
        note: "Case 5 — loan COMPLETED / CLOSED. Final repayment reconciled, account Paid in Full, clearance documents generated, and automated logbook release starts.",
        tab: "release",
        asOf: "2027-11-20",
        payments: quote ? onTimeReceipts(quote) : [],
      },
      rolled: {
        note: "Missed from 01/09/2026 through 20/10/2026. Weekly compounding continues after the next installment, then (next installment + all arrears) × 5%. Outstanding 622,380.90.",
        tab: "arrears",
        asOf: "2026-10-20",
        payments: [],
        loan: {
          clientName: "Example client",
          logbookRef: "KES 3,000,000 · 24 months · 4.1% flat",
          currency: "KES",
          principal: "3000000",
          tenure: "24",
          rate: "4.1",
          trackingFee: "0",
          penaltyRate: "5",
          graceDays: "7",
          disbursement: "2026-08-02",
          firstDue: "2026-09-01",
        },
      },
    };

    const example = examples[name];
    if (!example) return false;

    const loan = example.loan || terms;
    applySnapshot({
      clientName: loan.clientName,
      logbookRef: loan.logbookRef,
      currency: loan.currency,
      principal: loan.principal,
      tenure: loan.tenure,
      rate: loan.rate,
      trackingFee: loan.trackingFee,
      penaltyRate: loan.penaltyRate,
      graceDays: loan.graceDays,
      disbursement: loan.disbursement,
      firstDue: loan.firstDue,
      asOf: example.asOf,
      tab: example.tab,
      payments: example.payments,
      demandFees: [],
      example: name,
    });
    state.example = name;
    state.accountNumber = "";
    state.lmsStatus = "";
    markExampleButtons();
    setSourceNote(example.note);
    if (typeof App !== "undefined") App.showTab("calculator");
    showTab(example.tab);
    if ($("payDate")) $("payDate").value = example.asOf;
    return true;
  }

  function readLoan() {
    // A disbursed LMS account is the source of truth. Rehydrate the calculator
    // from the live loan so statements do not render an empty zero-balance file
    // when the calculator form fields are not populated.
    const live = liveLoan();
    if (live && Array.isArray(live.schedule) && live.schedule.length) {
      const principal = Number(live.disbursedAmount || live.amount || live.currentPrincipal) || 0;
      const tenure = Number(live.tenorMonths || live.tenure || live.schedule.length) || live.schedule.length;
      const rate = Number(live.approvedRate || live.rate || 0) / 100;
      const trackingFee = Number(live.trackingFee) || 0;
      const disbursement = parseISODate(live.disbursementDate || live.disbursement) || new Date();
      const firstDue = parseISODate(live.firstDueDate || live.schedule[0].dueDate) || live.schedule[0].dueDate;
      const asOf = parseISODate($("asOf")?.value) || new Date();
      if ($("asOf") && !$("asOf").value) $("asOf").value = toISODate(asOf);
      const schedule = live.schedule.map(function (row, index) {
        const dueDate = parseISODate(row.dueDate) || new Date();
        return {
          n: Number(row.period || row.n || index + 1),
          dueDate,
          principal: Number(row.principal) || 0,
          interest: Number(row.interest) || 0,
          tracking: Number(row.tracking || row.trackingFee) || 0,
          installment: Number(row.installment) || 0,
          remainingPrincipal: Number(row.balance ?? row.remainingPrincipal) || 0,
          remainingPayable: Number(row.remainingPayable) || 0
        };
      });

      // Import LMS receipts once per account. The calculator statement uses
      // these entries as credits against the live disbursed schedule.
      if (state._lmsHydratedAccount !== live.accountNumber) {
        state.payments = [];
        state.nextPayId = 1;
        state._lmsHydratedAccount = live.accountNumber;
        if (Array.isArray(live.repaymentsHistory)) {
          live.repaymentsHistory.slice().reverse().forEach(function (receipt, index) {
            const date = parseISODate(receipt.date) || asOf;
            const row = schedule[index] || schedule.find(r => r.status !== "PAID");
            addPayment(Number(row?.n || index + 1), date, Number(receipt.amount) || 0,
              receipt.receiptNo || receipt.reference || "LMS RECEIPT");
          });
        }
      }

      const totalPayable = schedule.reduce((sum, row) => sum + row.installment, 0);
      const totalInterest = schedule.reduce((sum, row) => sum + row.interest, 0);
      const totalTracking = schedule.reduce((sum, row) => sum + row.tracking, 0);
      return {
        principal,
        tenure,
        rate,
        trackingFee,
        penaltyRate: Number(live.penaltyRate || 5) / 100,
        graceDays: Number(live.graceDays || 7),
        disbursement,
        firstDue: parseISODate(firstDue) || schedule[0].dueDate,
        asOf,
        currency: "KES",
        clientName: live.customer || "",
        logbookRef: [live.vehicle, live.reg].filter(Boolean).join(" · "),
        monthlyPrincipal: schedule[0].principal || 0,
        monthlyInterest: schedule[0].interest || 0,
        installment: schedule[0].installment || 0,
        totalInterest,
        totalTracking,
        totalPayable,
        schedule
      };
    }

    const principal = readNumber("principal");
    const tenure = readNumber("tenure");
    const rate = readNumber("rate") / 100;
    const trackingFee = readNumber("trackingFee");
    const penaltyRate = readNumber("penaltyRate") / 100;
    const graceDays = readNumber("graceDays");
    const disbursement = parseISODate($("disbursement").value);
    const asOf = parseISODate($("asOf").value);
    const currency = $("currency").value.trim();
    const clientName = $("clientName").value.trim();
    const logbookRef = $("logbookRef").value.trim();

    if (
      !(principal > 0) ||
      !(tenure >= 1) ||
      !Number.isFinite(rate) || rate < 0 ||
      !Number.isFinite(trackingFee) || trackingFee < 0 ||
      !Number.isFinite(penaltyRate) || penaltyRate < 0 ||
      !Number.isFinite(graceDays) || graceDays < 0 ||
      !disbursement ||
      !asOf
    ) {
      return null;
    }

    const firstDueInput = $("firstDue") ? parseISODate($("firstDue").value) : null;
    const firstDue = firstDueInput || FinEngine.firstOfNextMonth(disbursement);
    const quote = FinEngine.quoteLogbookFlat(
      principal,
      rate * 100,
      tenure,
      trackingFee,
      toISODate(disbursement),
      toISODate(firstDue)
    );
    if (!quote) return null;

    const schedule = quote.schedule.map(function (row) {
      return {
        n: row.n,
        dueDate: parseISODate(row.dueDate),
        principal: row.principal,
        interest: row.interest,
        tracking: row.tracking,
        installment: row.installment,
        remainingPrincipal: row.remainingPrincipal,
        remainingPayable: row.remainingPayable,
      };
    });

    return {
      principal: principal,
      tenure: tenure,
      rate: rate,
      trackingFee: trackingFee,
      penaltyRate: penaltyRate,
      graceDays: graceDays,
      disbursement: disbursement,
      firstDue: firstDue,
      asOf: asOf,
      currency: currency,
      clientName: clientName,
      logbookRef: logbookRef,
      monthlyPrincipal: quote.monthlyPrincipal,
      monthlyInterest: quote.monthlyInterest,
      installment: quote.installment,
      totalInterest: quote.totalInterest,
      totalTracking: quote.totalTracking,
      totalPayable: quote.totalPayable,
      schedule: schedule,
    };
  }

  function addPayment(n, date, amount, ref) {
    state.payments.push({
      id: state.nextPayId++,
      n: n,
      date: date,
      amount: Math.max(0, Math.round(Number(amount))),
      ref: ref || "",
    });
  }

  function addDemandFee(date, amount, ref) {
    state.demandFees.push({
      id: state.nextDemandId++,
      date: date,
      amount: Math.max(0, Math.round(Number(amount))),
      ref: ref || "",
    });
  }

  function collectedAsOf(loan) {
    let total = 0;
    state.payments.forEach(function (p) {
      if (cmpDate(p.date, loan.asOf) <= 0) total += p.amount;
    });
    const account = accountAsOf(loan, loan.asOf);
    return {
      total: total,
      toInstallment: account.paidToInstallment,
      toPenalty: account.paidToPenalty,
      toDemand: account.paidToDemand,
    };
  }

  function accountAsOf(loan, asOf) {
    const result = FinEngine.projectLogbookArrears({
      schedule: loan.schedule,
      penaltyRate: loan.penaltyRate,
      graceDays: loan.graceDays,
      asOf: asOf,
      payments: state.payments.map(function (p) {
        return { id: p.id, n: p.n, date: p.date, amount: p.amount };
      }),
      demandFees: state.demandFees.map(function (d) {
        return { id: d.id, date: d.date, amount: d.amount, ref: d.ref };
      }),
    });
    return result || {
      remainingInstallment: 0,
      remainingPenalties: 0,
      remainingDemand: 0,
      outstanding: 0,
      charges: [],
      demandCharges: [],
      rolls: [],
      byInstallment: {},
      paidAmount: 0,
      paidToInstallment: 0,
      paidToPenalty: 0,
      paidToDemand: 0,
      chargedDemand: 0,
      currentN: 0,
      nextPenalty: null,
      paymentAllocations: [],
      closed: false,
      settled: false,
      status: "CURRENT",
    };
  }

  function penaltyFormula(ch, loan) {
    const pct = formatPct(loan.penaltyRate);
    if (ch.mode === "weekly") {
      return moneyPrecise(ch.base) + " × " + pct + "% + " + moneyPrecise(ch.base);
    }
    return moneyPrecise(ch.base) + " × " + pct + "%";
  }

  function penaltyDescription(ch) {
    if (ch.mode === "first") return "Penalty";
    if (ch.mode === "combined") return "(next installment + all arrears) penalty";
    return "Additional weekly penalty";
  }

  function outstandingOnTime(loan) {
    const paidCount = loan.schedule.filter(function (row) {
      return cmpDate(row.dueDate, loan.asOf) <= 0;
    }).length;
    if (paidCount === 0) {
      return {
        paidCount: 0,
        remainingPrincipal: loan.principal,
        remainingPayable: loan.totalPayable,
        lastPaid: null,
      };
    }
    const last = loan.schedule[paidCount - 1];
    return {
      paidCount: paidCount,
      remainingPrincipal: last.remainingPrincipal,
      remainingPayable: last.remainingPayable,
      lastPaid: last,
    };
  }

  function arrearsAsOf(loan) {
    const account = accountAsOf(loan, loan.asOf);
    const unpaid = [];

    loan.schedule.forEach(function (row) {
      if (cmpDate(row.dueDate, loan.asOf) > 0) return;
      const st = account.byInstallment[row.n];
      if (!st || st.rolledTo || st.outstanding <= 0) return;
      unpaid.push({ row: row, state: st });
    });

    return {
      unpaid: unpaid,
      penalties: account.charges,
      demandCharges: account.demandCharges,
      rolls: account.rolls,
      byInstallment: account.byInstallment,
      unpaidInstallments: account.remainingInstallment,
      paidTowardDue: account.paidToInstallment,
      penaltyTotal: account.remainingPenalties,
      demandTotal: account.remainingDemand,
      chargedDemand: account.chargedDemand,
      total: account.outstanding,
      nextPenalty: account.remainingInstallment + account.remainingPenalties > 0 ? account.nextPenalty : null,
      account: account,
    };
  }

  function statusFor(loan, row, account) {
    account = account || accountAsOf(loan, loan.asOf);
    if (cmpDate(row.dueDate, loan.asOf) > 0) return "upcoming";
    const st = account.byInstallment[row.n];
    if (!st) return "due";
    if (st.rolledTo) return "rolled";
    if (st.outstanding <= 0) return "paid";
    if (st.paidAmount > 0) return "partial";
    if (st.broughtForward > 0 || cmpDate(loan.asOf, addDays(row.dueDate, loan.graceDays)) >= 0) {
      return "overdue";
    }
    return "due";
  }

  function kpi(label, value, emphasis, danger) {
    const cls = "kpi" + (emphasis ? " emphasis" : "") + (danger ? " danger" : "");
    return (
      '<article class="' + cls + '">' +
      '<span class="label">' + escapeHtml(label) + "</span>" +
      '<div class="value">' + escapeHtml(value) + "</div>" +
      "</article>"
    );
  }

  function renderFormula(loan) {
    const c = loan.currency;
    const pct = (loan.rate * 100).toFixed(loan.rate * 100 % 1 === 0 ? 0 : 2);
    $("formula").innerHTML =
      "<strong>" + escapeHtml(loan.clientName || "Client") +
      (loan.logbookRef ? " · " + escapeHtml(loan.logbookRef) : "") +
      "</strong> · Disbursed " + formatDate(loan.disbursement) +
      " · First installment " + formatDate(loan.firstDue || loan.schedule[0].dueDate) +
      "<br>Interest (flat) = " + money(loan.principal, c) + " × " + pct + "% × " +
      loan.tenure + " = <strong>" + money(loan.totalInterest, c) + "</strong>" +
      " · Tracking = " + money(loan.trackingFee, c) + " × " + loan.tenure +
      " = <strong>" + money(loan.totalTracking, c) + "</strong>" +
      "<br>Monthly installment = (" + money(loan.principal, c) + " ÷ " + loan.tenure +
      ") + (" + money(loan.principal, c) + " × " + pct + "%) + " +
      money(loan.trackingFee, c) + " = <strong>" + money(loan.monthlyPrincipal, c) +
      " + " + money(loan.monthlyInterest, c) + " + " + money(loan.trackingFee, c) +
      " = " + money(loan.installment, c) + "</strong>" +
      " · On-time total = " + money(loan.installment, c) + " × " + loan.tenure +
      " = <strong>" + money(loan.totalPayable, c) + "</strong>" +
      "<br>Outstanding total balance = remaining principal + remaining interest + remaining tracking. When every installment, fee and penalty is settled the loan is <strong>COMPLETED / CLOSED</strong> and automated <strong>logbook release</strong> starts.";
  }

  function renderOnTime(loan) {
    const c = loan.currency;
    const currentN = outstandingOnTime(loan).paidCount;
    const last = loan.schedule[loan.schedule.length - 1];
    const completed = last && cmpDate(last.dueDate, loan.asOf) <= 0;
    const head =
      "<tr>" +
      '<th class="left">Month</th>' +
      '<th class="left">Due date</th>' +
      "<th>Payment made</th>" +
      "<th>Principal paid</th>" +
      "<th>Interest paid</th>" +
      "<th>Tracking paid</th>" +
      "<th>Outstanding principal</th>" +
      "<th>Outstanding total balance</th>" +
      "</tr>";

    let body =
      '<tr class="is-opening">' +
      '<td class="left">0</td>' +
      '<td class="left">' + formatDate(loan.disbursement) + " · Disbursed</td>" +
      "<td>—</td><td>—</td><td>—</td><td>—</td>" +
      "<td>" + money(loan.principal, c) + "</td>" +
      "<td>" + money(loan.totalPayable, c) + "</td>" +
      "</tr>";

    loan.schedule.forEach(function (row) {
      const current = row.n === currentN ? " is-current" : "";
      const closedRow = completed && row.n === loan.schedule.length ? " is-paid" : "";
      body +=
        '<tr class="' + current + closedRow + '">' +
        '<td class="left">' + row.n + "</td>" +
        '<td class="left">' + formatDate(row.dueDate) + "</td>" +
        "<td>" + money(row.installment, c) + "</td>" +
        "<td>" + money(row.principal, c) + "</td>" +
        "<td>" + money(row.interest, c) + "</td>" +
        "<td>" + money(row.tracking, c) + "</td>" +
        "<td>" + money(row.remainingPrincipal, c) + "</td>" +
        "<td>" + money(row.remainingPayable, c) + "</td>" +
        "</tr>";
    });

    if (completed) {
      body +=
        '<tr class="is-paid is-strong">' +
        '<td class="left"></td>' +
        '<td class="left">Loan status</td>' +
        '<td colspan="5" class="left">COMPLETED / CLOSED — all principal, interest, tracking, fees and penalties settled. Outstanding total balance = remaining principal + remaining interest + remaining tracking = ' +
        money(0, c) + '. Automated logbook release starts (Paid in Full).</td>' +
        "<td>" + money(0, c) + "</td>" +
        "</tr>";
    }

    $("scheduleTable").querySelector("thead").innerHTML = head;
    $("scheduleTable").querySelector("tbody").innerHTML = body;
  }

  function renderArrears(loan) {
    const c = loan.currency;
    const arrears = arrearsAsOf(loan);
    const dueCount = loan.schedule.filter(function (row) {
      return cmpDate(row.dueDate, loan.asOf) <= 0;
    }).length;

    $("arrearsIntro").innerHTML =
      "As of <strong>" + formatDate(loan.asOf) + "</strong>, " +
      dueCount + " installment" + (dueCount === 1 ? " is" : "s are") +
      " due. Missed due date → overdue immediately. After " +
      loan.graceDays + " grace days the first penalty is " + formatPct(loan.penaltyRate) +
      "% of the remaining overdue installment. Each following week: previous × " +
      formatPct(loan.penaltyRate) + "% + previous, until the next installment. A late receipt that clears installment + penalty marks that installment <strong>PAID</strong> and stops further penalties on it. A partial receipt leaves the unpaid remainder; the same weekly rules then apply to that remainder. Receipts clear penalty first, then demand fees, then remaining installments.";

    let summary =
      "<h3>Clearance statement</h3>" +
      '<div class="ledger-row"><span>Remaining installments</span><span>' +
      money(arrears.unpaidInstallments, c) + "</span></div>";

    if (arrears.paidTowardDue > 0) {
      summary +=
        '<div class="ledger-row muted"><span>Paid toward installments</span><span>' +
        money(arrears.paidTowardDue, c) + "</span></div>";
    }

    loan.schedule.forEach(function (row) {
      if (cmpDate(row.dueDate, loan.asOf) > 0) return;
      const st = arrears.byInstallment[row.n];
      if (!st || st.rolledTo) return;
      if (!(st.paidAmount > 0 || st.outstanding > 0)) return;
      const status = statusFor(loan, row, arrears.account);
      summary +=
        '<div class="ledger-row muted"><span>#' + row.n +
        " · Installment amount</span><span>" + money(row.installment, c) + "</span></div>";
      if (st.paidToInstallment > 0 || st.paidAmount > 0) {
        summary +=
          '<div class="ledger-row muted"><span>Amount paid</span><span>' +
          money(st.paidToInstallment || st.paidAmount, c) + "</span></div>";
      }
      summary +=
        '<div class="ledger-row muted"><span>Outstanding installment</span><span>' +
        money(st.remainingInstallment, c) + "</span></div>";
      if (status === "paid") {
        summary +=
          '<div class="ledger-row muted"><span>Status</span><span>PAID — further penalties stopped</span></div>';
      } else if (st.remainingPenalties > 0 || (arrears.nextPenalty && st.remainingInstallment > 0)) {
        const applicable = st.remainingPenalties > 0
          ? st.remainingPenalties
          : (arrears.nextPenalty && arrears.nextPenalty.mode === "first" ? arrears.nextPenalty.amount : 0);
        if (applicable > 0) {
          summary +=
            '<div class="ledger-row muted"><span>Applicable penalty</span><span>' +
            moneyPrecise(applicable, c) + "</span></div>";
        }
      }
    });

    summary +=
      '<div class="ledger-row"><span>Penalty on remaining</span><span>' +
      moneyPrecise(arrears.penaltyTotal, c) + "</span></div>";

    if (arrears.penalties.length) {
      summary += '<ul class="penalty-list">';
      arrears.penalties.forEach(function (p) {
        summary +=
          "<li><span>" + formatDate(p.date) + " · " + penaltyDescription(p) +
          " · " + penaltyFormula(p, loan) +
          "</span><span>" + moneyPrecise(p.amount, c) + "</span></li>";
      });
      summary += "</ul>";
    }

    summary +=
      '<div class="ledger-row"><span>Demand fees remaining</span><span>' +
      money(arrears.demandTotal, c) + "</span></div>";

    if (arrears.demandCharges && arrears.demandCharges.length) {
      summary += '<ul class="penalty-list">';
      arrears.demandCharges.forEach(function (d) {
        summary +=
          "<li><span>" + formatDate(d.date) +
          (d.ref ? " · " + escapeHtml(d.ref) : " · Demand fee") +
          "</span><span>" + money(d.amount, c) + "</span></li>";
      });
      summary += "</ul>";
    }

    if (arrears.rolls.length) {
      summary +=
        '<div class="ledger-row"><span>Rolled into next installment</span><span>' +
        arrears.rolls.length + "</span></div>";
      summary += '<ul class="penalty-list">';
      arrears.rolls.forEach(function (roll) {
        summary +=
          "<li><span>" + formatDate(roll.date) + " · #" + roll.from +
          " " + money(roll.balance, c) + " + #" + roll.to + " " +
          money(roll.nextInstallment, c) +
          "</span><span>" + money(roll.combined, c) + "</span></li>";
      });
      summary += "</ul>";
    }

    summary +=
      '<div class="ledger-row total"><span>Total to clear</span><span>' +
      moneyPrecise(arrears.total, c) + "</span></div>";

    if (arrears.nextPenalty) {
      const np = arrears.nextPenalty;
      let nextNote =
        "Next penalty on " + formatDate(np.date) +
        " · " + moneyPrecise(np.amount, c) + " (" + penaltyFormula(np, loan) + ")";
      if (np.mode === "combined" && np.rollsOn) {
        nextNote =
          "On " + formatDate(np.rollsOn) + " the next installment is added to arrears. " +
          "The next weekly charge on " + formatDate(np.date) +
          " is (next installment + all arrears) penalty = " +
          moneyPrecise(np.amount, c) + " (" + penaltyFormula(np, loan) + ").";
      }
      summary += '<p class="hint">' + nextNote + "</p>";
    } else if (arrears.account && arrears.account.closed) {
      summary += '<p class="hint">Loan COMPLETED / CLOSED. All installments, interest, tracking, penalties and fees are settled. <button type="button" class="btn btn-sm btn-success" data-calc-tab="release">Open logbook release</button></p>';
    } else if (arrears.total <= 0) {
      summary += '<p class="hint">No arrears as of this date. Current installment is PAID; further penalties on it have stopped.</p>';
    }

    $("arrearsSummary").innerHTML = summary;

    const ledger = buildArrearsLedger(loan);
    const head =
      "<tr>" +
      '<th class="left">Date</th>' +
      '<th class="left">Description</th>' +
      "<th>Amount</th>" +
      "</tr>";

    let body = "";
    if (!ledger.lines.length) {
      body = emptyRow(3, "No overdue installments or penalties as of this date.");
    } else {
      ledger.lines.forEach(function (line) {
        const rowClass =
          line.kind === "penalty" ? "is-overdue" :
          line.kind === "pay" ? "is-paid" :
          line.kind === "installment" ? "is-overdue" : "";
        const amountText = line.kind === "pay"
          ? "(" + moneyPrecise(line.amount, c) + ")"
          : moneyPrecise(line.amount, c);
        const note = line.note ? " <span class=\"muted\">(" + escapeHtml(line.note) + ")</span>" : "";
        body +=
          '<tr class="' + rowClass + '">' +
          '<td class="left">' + formatDate(line.date) + "</td>" +
          '<td class="left">' + escapeHtml(line.description) + note + "</td>" +
          "<td>" + amountText + "</td>" +
          "</tr>";
      });
      body +=
        '<tr class="is-strong">' +
        '<td class="left"></td>' +
        '<td class="left">Outstanding amount</td>' +
        "<td>" + moneyPrecise(ledger.total, c) + "</td>" +
        "</tr>";
    }

    $("arrearsTable").querySelector("thead").innerHTML = head;
    $("arrearsTable").querySelector("tbody").innerHTML = body;
  }

  function buildArrearsLedger(loan) {
    const account = accountAsOf(loan, loan.asOf);
    const lines = [];
    let overdueLabeled = false;

    loan.schedule.forEach(function (row) {
      if (cmpDate(row.dueDate, loan.asOf) > 0) return;
      const st = account.byInstallment[row.n];
      const unpaid = st && (st.outstanding > 0 || st.rolledTo);
      let description = "Month " + row.n + " installment";
      if (unpaid) {
        description = "Month " + row.n + " — " + (overdueLabeled ? "next installment" : "Overdue installment");
        overdueLabeled = true;
      }
      lines.push({
        date: row.dueDate,
        description: description,
        amount: row.installment,
        kind: "installment",
        rank: 0,
      });
    });

    (account.demandCharges || []).forEach(function (d) {
      lines.push({
        date: d.date,
        description: d.ref ? "Demand fee — " + d.ref : "Demand fee",
        amount: d.amount,
        kind: "demand",
        rank: 1,
      });
    });

    state.payments.forEach(function (p) {
      if (!p.date || !(p.amount > 0) || cmpDate(p.date, loan.asOf) > 0) return;
      lines.push({
        date: p.date,
        description: p.ref ? "Payment received — " + p.ref : "Payment received",
        amount: p.amount,
        kind: "pay",
        rank: 2,
        id: p.id,
      });
    });

    account.charges.forEach(function (ch) {
      lines.push({
        date: ch.date,
        description: penaltyDescription(ch),
        amount: ch.amount,
        kind: "penalty",
        note: penaltyFormula(ch, loan),
        rank: 3,
      });
    });

    lines.sort(function (a, b) {
      const byDate = cmpDate(a.date, b.date);
      if (byDate !== 0) return byDate;
      if (a.rank !== b.rank) return a.rank - b.rank;
      return (a.id || 0) - (b.id || 0);
    });

    return { lines: lines, total: account.outstanding, account: account };
  }

  function firstOpenInstallment(loan) {
    const account = accountAsOf(loan, loan.asOf);
    if (account.currentN && account.outstanding > 0) return account.currentN;
    for (let i = 0; i < loan.schedule.length; i++) {
      if (cmpDate(loan.schedule[i].dueDate, loan.asOf) > 0) return loan.schedule[i].n;
    }
    return loan.schedule.length || 1;
  }

  function updatePayHint(loan) {
    const n = Number($("payInstallment").value);
    const row = loan.schedule[n - 1];
    const account = accountAsOf(loan, loan.asOf);
    if (!row) {
      $("payHint").textContent = "Choose an installment to apply this receipt against.";
      return;
    }
    const c = loan.currency;
    const st = account.byInstallment[row.n];
    const status = statusFor(loan, row, account);
    let html =
      "#" + row.n + " due " + formatDate(row.dueDate) + " · " + status;
    if (st && st.rolledTo) {
      html +=
        "<br>Unpaid balance from this installment was added to #" + st.rolledTo + ".";
    }
    const toClear = account.outstanding;
    html +=
      "<br>Payment clears running penalty first (" + moneyPrecise(account.remainingPenalties, c) +
      "), then demand fees (" + money(account.remainingDemand, c) +
      "), then remaining installments (" + money(account.remainingInstallment, c) +
      ").";
    if (st && st.paidToInstallment > 0 && st.outstanding > 0) {
      html +=
        "<br>Partial: installment " + money(row.installment, c) +
        " · paid " + money(st.paidToInstallment, c) +
        " · outstanding installment " + money(st.remainingInstallment, c);
      if (account.nextPenalty && account.nextPenalty.mode === "first") {
        html +=
          " · applicable penalty " + moneyPrecise(account.nextPenalty.amount, c) +
          " (" + money(st.remainingInstallment, c) + " × " + formatPct(loan.penaltyRate) + "%)";
      }
    }
    if (status === "paid") {
      html += "<br><strong>Installment PAID. Further penalties on this installment have stopped.</strong>";
    } else if (toClear > 0) {
      html +=
        "<br><strong>To clear today " + moneyPrecise(toClear, c) + "</strong>";
      if (account.remainingPenalties > 0 && account.remainingInstallment > 0) {
        html +=
          " (" + money(account.remainingInstallment, c) + " installment + " +
          moneyPrecise(account.remainingPenalties, c) + " penalty)";
      }
    }
    if (account.nextPenalty) {
      const np = account.nextPenalty;
      html +=
        "<br>Next penalty " + formatDate(np.date) + " · " + moneyPrecise(np.amount, c);
      if (np.rollsOn) {
        html +=
          " after #" + np.n + " is added on " + formatDate(np.rollsOn);
      }
    }
    $("payHint").innerHTML = html;
  }

  function renderPayments(loan) {
    const c = loan.currency;
    const collected = collectedAsOf(loan);
    const select = $("payInstallment");
    const previous = select.value;
    let html = "";
    const account = accountAsOf(loan, loan.asOf);
    loan.schedule.forEach(function (row) {
      const st = account.byInstallment[row.n];
      const status = statusFor(loan, row, account);
      const dueAmt =
        status === "upcoming" ? row.installment :
        status === "rolled" ? st.rolledAmount :
        st.outstanding;
      html +=
        '<option value="' + row.n + '">#' + row.n +
        " · " + formatDate(row.dueDate) +
        " · " + status +
        " · due " + money(dueAmt, c) +
        "</option>";
    });
    select.innerHTML = html;
    if (previous && select.querySelector('option[value="' + previous + '"]')) {
      select.value = previous;
    } else {
      select.value = String(firstOpenInstallment(loan));
    }
    if ($("payDate") && !$("payDate").value) $("payDate").value = toISODate(loan.asOf);
    updatePayHint(loan);

    const rows = state.payments.slice().sort(function (a, b) {
      const byDate = cmpDate(a.date, b.date);
      if (byDate !== 0) return byDate;
      return a.id - b.id;
    });

    $("paymentsSummary").innerHTML =
      "<h3>Receipts</h3>" +
      '<div class="ledger-row"><span>Payments captured</span><span>' + rows.length + "</span></div>" +
      '<div class="ledger-row"><span>Received as of ' + formatDate(loan.asOf) + "</span><span>" +
      money(collected.total, c) + "</span></div>" +
      '<div class="ledger-row"><span>Applied to penalties</span><span>' +
      money(collected.toPenalty, c) + "</span></div>" +
      '<div class="ledger-row"><span>Applied to demand fees</span><span>' +
      money(collected.toDemand, c) + "</span></div>" +
      '<div class="ledger-row"><span>Applied to installments</span><span>' +
      money(collected.toInstallment, c) + "</span></div>" +
      '<div class="ledger-row total ok"><span>Total received</span><span>' +
      money(collected.total, c) + "</span></div>";

    const allocations = {};
    (account.paymentAllocations || []).forEach(function (a) {
      if (a && a.id != null) allocations[a.id] = a;
    });

    const head =
      "<tr>" +
      '<th class="left">Date</th>' +
      '<th class="left">Receipt</th>' +
      '<th class="left">Installment</th>' +
      '<th class="left">Due date</th>' +
      "<th>Amount paid</th>" +
      "<th>To penalty</th>" +
      "<th>To installment</th>" +
      '<th class="left"></th>' +
      "</tr>";

    let body = "";
    if (!rows.length) {
      body =
        '<tr><td class="left muted" colspan="8">No payments captured yet. Record a receipt on the left — it clears penalty first, then the monthly installment.</td></tr>';
    } else {
      rows.forEach(function (p) {
        const row = loan.schedule[p.n - 1];
        const future = cmpDate(p.date, loan.asOf) > 0;
        const alloc = allocations[p.id];
        body +=
          "<tr>" +
          '<td class="left">' + formatDate(p.date) + (future ? ' <span class="muted">(after as-of)</span>' : "") + "</td>" +
          '<td class="left">' + (p.ref ? escapeHtml(p.ref) : "—") + "</td>" +
          '<td class="left">#' + p.n + "</td>" +
          '<td class="left">' + (row ? formatDate(row.dueDate) : "—") + "</td>" +
          "<td>" + money(p.amount, c) + "</td>" +
          "<td>" + (alloc ? money(alloc.toPenalty, c) : "—") + "</td>" +
          "<td>" + (alloc ? money(alloc.toInstallment, c) : "—") + "</td>" +
          '<td class="left"><button type="button" class="btn ghost btn-small" data-del-pay="' +
          p.id + '">Remove</button></td>' +
          "</tr>";
      });
    }

    $("paymentsTable").querySelector("thead").innerHTML = head;
    $("paymentsTable").querySelector("tbody").innerHTML = body;
  }

  function renderDemandFees(loan) {
    const c = loan.currency;
    const account = accountAsOf(loan, loan.asOf);
    const demandRows = state.demandFees.slice().sort(function (a, b) {
      const byDate = cmpDate(a.date, b.date);
      if (byDate !== 0) return byDate;
      return a.id - b.id;
    });

    if ($("payDate") && !$("payDate").value) $("payDate").value = toISODate(loan.asOf);
    if (!$("demandDate").value) $("demandDate").value = toISODate(loan.asOf);
    if (!$("stmtDemandDate").value) $("stmtDemandDate").value = toISODate(loan.asOf);

    $("demandIntro").innerHTML =
      "Demand fees are <strong>optional</strong>. Skip this tab if the client has no demand notice. Each captured fee is posted as a debit on the client statement as of <strong>" +
      formatDate(loan.asOf) + "</strong>.";

    $("demandSummary").innerHTML =
      "<h3>Demand fees</h3>" +
      '<div class="ledger-row"><span>Notices captured</span><span>' + demandRows.length + "</span></div>" +
      '<div class="ledger-row"><span>Charged as of ' + formatDate(loan.asOf) + "</span><span>" +
      money(account.chargedDemand, c) + "</span></div>" +
      '<div class="ledger-row"><span>Paid toward demand</span><span>' +
      money(account.paidToDemand, c) + "</span></div>" +
      '<div class="ledger-row total"><span>Demand fees remaining</span><span>' +
      money(account.remainingDemand, c) + "</span></div>" +
      (account.chargedDemand
        ? '<p class="hint">These fees are mapped as debit lines on the client statement.</p>'
        : '<p class="hint">No demand fee on this account yet. Nothing is added to the statement until you record one.</p>');

    const demandHead =
      "<tr>" +
      '<th class="left">Date</th>' +
      '<th class="left">Notice / reference</th>' +
      "<th>Amount</th>" +
      '<th class="left"></th>' +
      "</tr>";

    let demandBody = "";
    if (!demandRows.length) {
      demandBody =
        '<tr><td class="left muted" colspan="4">No demand fees captured. This is optional — record a notice only if one was issued. It then appears as a debit on the client statement.</td></tr>';
    } else {
      demandRows.forEach(function (d) {
        const future = cmpDate(d.date, loan.asOf) > 0;
        demandBody +=
          "<tr>" +
          '<td class="left">' + formatDate(d.date) + (future ? ' <span class="muted">(after as-of)</span>' : "") + "</td>" +
          '<td class="left">' + (d.ref ? escapeHtml(d.ref) : "Demand fee") + "</td>" +
          "<td>" + money(d.amount, c) + "</td>" +
          '<td class="left"><button type="button" class="btn ghost btn-small" data-del-demand="' +
          d.id + '">Remove</button></td>' +
          "</tr>";
      });
    }

    $("demandTable").querySelector("thead").innerHTML = demandHead;
    $("demandTable").querySelector("tbody").innerHTML = demandBody;
  }

  function buildStatement(loan) {
    const asOf = loan.asOf;
    const events = [];
    const ledger = buildArrearsLedger(loan);

    // Before the first installment falls due, the statement must still show
    // the disbursed facility. Once installments are due, those schedule lines
    // become the contractual debit entries and the opening principal is not
    // added again.
    const hasDueInstallment = loan.schedule.some(function (row) {
      return cmpDate(row.dueDate, asOf) <= 0;
    });
    if (!hasDueInstallment && cmpDate(loan.disbursement, asOf) <= 0 && loan.principal > 0) {
      events.push({
        type: "opening",
        date: loan.disbursement,
        description: "Facility disbursed",
        debit: loan.principal,
        credit: 0,
        rank: -1,
        id: -1
      });
    }

    ledger.lines.forEach(function (line) {
      events.push({
        type: line.kind,
        date: line.date,
        description: line.note ? line.description + " (" + line.note + ")" : line.description,
        debit: line.kind === "pay" ? 0 : line.amount,
        credit: line.kind === "pay" ? line.amount : 0,
        rank: line.rank,
        id: line.id,
      });
    });

    events.sort(function (a, b) {
      const byDate = cmpDate(a.date, b.date);
      if (byDate !== 0) return byDate;
      if (a.rank !== b.rank) return a.rank - b.rank;
      return (a.id || 0) - (b.id || 0);
    });

    let balance = 0;
    const lines = events.map(function (ev) {
      balance += ev.debit - ev.credit;
      return {
        date: ev.date,
        description: ev.description,
        debit: ev.debit,
        credit: ev.credit,
        balance: balance,
        type: ev.type,
      };
    });

    lines.push({
      date: asOf,
      description: "Closing Balance as of " + formatStatementDate(asOf),
      debit: 0,
      credit: 0,
      balance: balance,
      type: "closing",
    });

    return {
      lines: lines,
      closing: balance,
      asOfBalance: balance,
    };
  }

  function renderStatement(loan) {
    const statement = buildStatement(loan);
    const live = liveLoan();
    const data = typeof DataStore !== "undefined" ? DataStore.get() : {};
    const application = (data.applications || []).find(function (item) {
      return item.id === (live && live.appId);
    }) || {};
    const accountRef = live && live.accountNumber || state.accountNumber || "—";
    const client = String(loan.clientName || "—");
    const dateLabel = formatLedgerDate(loan.disbursement);
    const asOfLabel = formatLedgerDate(loan.asOf);

    $("statementIntro").innerHTML =
      "Client statement for <strong>" + escapeHtml(client) +
      "</strong> through <strong>" + asOfLabel +
      "</strong>. Transactions are listed in date order.";

    let rows = "";
    statement.lines.forEach(function (line) {
      const cls = line.type === "opening" ? " is-opening is-strong" :
        line.type === "closing" ? " is-closing is-strong" : "";
      const description = line.type === "opening" ? "Principal logbook loan" :
        line.type === "closing" ? "Closing balance" : line.description;
      rows +=
        '<tr class="' + cls.trim() + '">' +
        '<td class="left">' + formatLedgerDate(line.date) + "</td>" +
        '<td class="left">' + escapeHtml(description) + "</td>" +
        "<td>" + statementAmount(line.debit) + "</td>" +
        "<td>" + statementAmount(line.credit) + "</td>" +
        "<td>" + statementAmount(line.balance) + "</td>" +
        "</tr>";
    });

    const typeLabel = application.loanType === "STRAIGHT_LOAN" ? "STRAIGHT LOAN" : "LOGBOOK LOAN";
    $("statementDoc").innerHTML =
      '<article class="statement-page client-statement">' +
      '<header class="statement-letterhead client-statement-head">' +
      '<div class="statement-logo">Spectrum</div>' +
      '<div class="statement-logo-sub">CREDIT LIMITED</div>' +
      '<div class="statement-slogan">We Don\'t Lend. We Empower.</div>' +
      '<div class="statement-former">Formerly SWIFT CAPITAL LIMITED</div>' +
      '<div class="statement-contact">P.O. BOX 25597-00504, Nairobi<br>0705 333 666<br>Email: info@swiftcapitalltd.com<br>Website: www.swiftcapitalltd.com</div>' +
      "</header>" +
      '<div class="client-statement-meta">' +
      '<div class="statement-meta-left">' +
      '<div><strong>REF NO:</strong> ' + escapeHtml(accountRef) + ' &nbsp; <strong>PERIOD:</strong> ' + escapeHtml(loan.tenure) + ' MONTHS</div>' +
      '<div><strong>RATE:</strong> ' + escapeHtml(formatPct(loan.rate)) + '% &nbsp; <strong>LOAN DATE:</strong> ' + dateLabel + '</div>' +
      '<div><strong>CLIENT:</strong> ' + escapeHtml(client.toUpperCase()) + '</div>' +
      '</div>' +
      '<div class="statement-meta-right">' +
      '<div><strong>TYPE:</strong> ' + typeLabel + '</div>' +
      '<div><strong>PRINCIPAL AMT:</strong> ' + statementAmount(loan.principal) + '</div>' +
      '</div>' +
      '</div>' +
      '<div class="statement-table-wrap">' +
      '<table class="statement-table">' +
      "<thead><tr>" +
      '<th class="left">DATE</th>' +
      '<th class="left">TRANSACTION</th>' +
      "<th>DEBIT</th>" +
      "<th>CREDIT</th>" +
      "<th>BALANCE</th>" +
      "</tr></thead>" +
      "<tbody>" + rows + "</tbody>" +
      "</table></div>" +
      "</article>";
  }

  function liveLoan() {
    if (typeof DataStore === "undefined") return null;
    const data = DataStore.get();
    const accountNumber = state.accountNumber || data.selectedLoanId || "";
    if (!accountNumber) return null;
    const loan = (data.loans || []).find(function (x) {
      return x.accountNumber === accountNumber;
    }) || null;
    if (loan && !state.accountNumber) {
      state.accountNumber = loan.accountNumber;
      state.lmsStatus = loan.status || "";
    }
    return loan;
  }

  function loanClosed(loan) {
    const account = accountAsOf(loan, loan.asOf);
    if (account && account.closed) return true;
    const st = String(state.lmsStatus || "").toUpperCase();
    return st === "PAID_IN_FULL" || st === "CLOSED" || st === "COMPLETED";
  }

  function letterhead(title) {
    return (
      '<header class="statement-letterhead">' +
      "<h1>SPECTRUM CREDIT LIMITED</h1>" +
      "<h2>" + escapeHtml(title) + "</h2>" +
      "</header>"
    );
  }

  function clearanceDocs(loan) {
    const c = loan.currency;
    const client = (loan.clientName || "the client").toUpperCase();
    const asOfLabel = formatStatementDate(loan.asOf);
    const vehicle = (loan.logbookRef || "—").toUpperCase();
    const lastPay = state.payments.filter(function (p) {
      return p.date && cmpDate(p.date, loan.asOf) <= 0;
    }).sort(function (a, b) {
      return cmpDate(b.date, a.date) || b.id - a.id;
    })[0];
    const live = liveLoan();
    const receipt = lastPay
      ? (lastPay.ref || "ON-TIME") + " · " + money(lastPay.amount, c) + " on " + formatDate(lastPay.date)
      : (live && live.repaymentsHistory && live.repaymentsHistory[0]
        ? live.repaymentsHistory[0].receiptNo + " · " + money(live.repaymentsHistory[0].amount, c)
        : "Final repayment reconciled");
    const signs =
      '<div class="statement-signs">' +
      '<div class="statement-sign">Prepared By: _______________</div>' +
      '<div class="statement-sign">Authorized By: _______________</div>' +
      '<div class="statement-sign">Date: _______________</div>' +
      '<div class="statement-sign">Client Signature: _______________</div>' +
      "</div>" +
      '<p class="statement-disclaimer">This is a computer-generated document. Please verify all figures before signing.</p>';

    const certificate =
      '<article class="statement-page">' +
      letterhead("Loan Clearance Certificate") +
      '<p>This is to certify that <strong>' + escapeHtml(client) +
      "</strong> has fully repaid the logbook loan facility of <strong>" + moneyFixed(loan.principal, c) +
      "</strong> for a period of <strong>" + loan.tenure + " months</strong>, disbursed on " +
      formatStatementDate(loan.disbursement) + ".</p>" +
      '<div class="statement-meta">' +
      "<div><strong>Client Name:</strong> " + escapeHtml(client) + "</div>" +
      "<div><strong>Logbook / Vehicle:</strong> " + escapeHtml(vehicle) + "</div>" +
      "<div><strong>Installment:</strong> " + moneyFixed(loan.installment, c) + "</div>" +
      "<div><strong>Total payable (on time):</strong> " + moneyFixed(loan.totalPayable, c) + "</div>" +
      "<div><strong>Final receipt:</strong> " + escapeHtml(receipt) + "</div>" +
      "<div><strong>Clearance date:</strong> " + asOfLabel + "</div>" +
      "</div>" +
      '<p>All principal, interest, tracking fees, penalties and other obligations have been settled. Outstanding total balance = remaining principal + remaining interest + remaining tracking = <strong>' +
      moneyFixed(0, c) + "</strong>. The loan is <strong>COMPLETED / CLOSED</strong> and the original logbook is approved for release.</p>" +
      signs +
      "</article>";

    const statement = $("statementDoc") ? $("statementDoc").innerHTML : "";

    const releaseLetter =
      '<article class="statement-page">' +
      letterhead("Logbook Release Letter") +
      "<p>To whom it may concern,</p>" +
      "<p>Spectrum Credit Limited hereby authorises the release of the original logbook held as security for the facility of <strong>" +
      escapeHtml(client) + "</strong> (" + escapeHtml(vehicle) + ").</p>" +
      '<div class="statement-meta">' +
      "<div><strong>Account / client:</strong> " + escapeHtml(client) + "</div>" +
      "<div><strong>Security:</strong> " + escapeHtml(vehicle) + "</div>" +
      "<div><strong>Loan amount:</strong> " + moneyFixed(loan.principal, c) + "</div>" +
      "<div><strong>Status:</strong> PAID IN FULL</div>" +
      "<div><strong>Release date:</strong> " + asOfLabel + "</div>" +
      "<div><strong>Collection:</strong> Branch pickup with National ID</div>" +
      "</div>" +
      "<p>The customer should visit the branch with a valid National ID. Release forms and a customer acknowledgement receipt must be signed at handover. NTSA caveat withdrawal will be lodged after physical collection.</p>" +
      signs +
      "</article>";

    const closure =
      '<article class="statement-page">' +
      letterhead("Account Closure Confirmation") +
      "<p>The logbook loan account for <strong>" + escapeHtml(client) +
      "</strong> is confirmed <strong>CLOSED</strong> as of " + asOfLabel + ".</p>" +
      '<div class="statement-meta">' +
      "<div><strong>Client Name:</strong> " + escapeHtml(client) + "</div>" +
      "<div><strong>Logbook / Vehicle:</strong> " + escapeHtml(vehicle) + "</div>" +
      "<div><strong>Principal:</strong> " + moneyFixed(loan.principal, c) + "</div>" +
      "<div><strong>Tenure:</strong> " + loan.tenure + " Months</div>" +
      "<div><strong>Final status:</strong> CLOSED → LOGBOOK RELEASED</div>" +
      "<div><strong>Final receipt:</strong> " + escapeHtml(receipt) + "</div>" +
      "</div>" +
      "<p>Collections follow-ups have stopped. The original logbook is due for physical handover against signed acknowledgement. This confirmation may be emailed or SMS-shared with the client.</p>" +
      signs +
      "</article>";

    return {
      certificate: certificate,
      statement: statement,
      letter: releaseLetter,
      closure: closure
    };
  }

  function renderRelease(loan) {
    if (!$("releaseIntro")) return;
    const closed = loanClosed(loan);
    const live = liveLoan();
    const rel = live && live.release;
    const stage = rel ? (rel.stage || 1) : (closed ? 3 : 1);
    const c = loan.currency;
    const account = accountAsOf(loan, loan.asOf);
    const remaining = closed ? 0 : account.outstanding;

    $("releaseIntro").innerHTML = closed
      ? "Loan is <strong>COMPLETED / CLOSED</strong> as of <strong>" + formatDate(loan.asOf) +
        "</strong>. Final repayment has been reconciled and the account is <strong>Paid in Full</strong>. Automated logbook release is in progress — clearance documents can be printed or emailed / SMS-shared with the client."
      : "Logbook release starts automatically only after every installment, fee and penalty is settled. As of <strong>" +
        formatDate(loan.asOf) + "</strong> the amount still to clear is <strong>" + moneyPrecise(remaining, c) +
        "</strong>. Record receipts until the loan is COMPLETED / CLOSED.";

    $("releaseSteps").innerHTML = RELEASE_STEPS.map(function (s) {
      const cls = !closed ? "pending" : (s.n < stage ? "done" : s.n === stage ? "active" : "pending");
      return '<div class="stage-step ' + cls + '">' + s.n + ". " + escapeHtml(s.short) + "</div>";
    }).join("");

    let summary = "<h3>" + (closed ? "Paid in Full — release file" : "Release blocked") + "</h3>";
    summary +=
      '<div class="ledger-row"><span>Loan status</span><span>' +
      (closed ? "COMPLETED / CLOSED" : (account.status || "CURRENT").replace(/_/g, " ")) + "</span></div>" +
      '<div class="ledger-row"><span>Outstanding</span><span>' + moneyPrecise(remaining, c) + "</span></div>";
    if (live) {
      summary +=
        '<div class="ledger-row"><span>LMS account</span><span>' + escapeHtml(live.accountNumber) + "</span></div>" +
        '<div class="ledger-row"><span>Vault / vehicle</span><span>' + escapeHtml(live.reg || loan.logbookRef || "—") + "</span></div>";
      if (rel) {
        summary +=
          '<div class="ledger-row"><span>Workflow step</span><span>' + rel.stage + ". " +
          escapeHtml((FinEngine.RELEASE_STEPS[(rel.stage || 1) - 1] || {}).short || rel.status) + "</span></div>" +
          '<div class="ledger-row"><span>Release status</span><span>' + escapeHtml((rel.status || "").replace(/_/g, " ")) + "</span></div>";
      }
    }
    RELEASE_STEPS.forEach(function (s) {
      summary +=
        '<div class="ledger-row muted"><span>' + s.n + ". " + escapeHtml(s.title) +
        "</span><span>" + (closed && s.n <= stage ? "Ready" : closed ? "Queued" : "Waiting") + "</span></div>";
    });
    if (closed) {
      summary +=
        '<p class="hint">' + escapeHtml(FinEngine.CUSTOMER_RELEASE_SMS || RELEASE_STEPS[4].detail) + "</p>";
      if (live) {
        summary +=
          '<div class="calc-toolbar"><button type="button" class="btn btn-sm btn-success" data-open-release="' +
          escapeHtml(live.accountNumber) + '"><i class="ti ti-lock-open"></i> Open live collateral release</button></div>';
      }
    } else {
      summary +=
        '<div class="calc-toolbar"><button type="button" class="btn btn-sm btn-success" data-calc-tab="payments">Record a receipt</button></div>';
    }
    $("releaseSummary").innerHTML = summary;

    if (!closed) {
      $("releaseToolbar").innerHTML = "";
      $("releaseDoc").innerHTML =
        '<div class="statement-page statement-empty">Clearance documents are generated after the loan is Paid in Full. Capture the remaining ' +
        moneyPrecise(remaining, c) + " first.</div>";
      return;
    }

    const docs = clearanceDocs(loan);
    const current = state.releaseDoc || "certificate";
    const buttons = [
      ["certificate", "Clearance certificate"],
      ["statement", "Final statement"],
      ["letter", "Release letter"],
      ["closure", "Closure confirmation"]
    ];
    $("releaseToolbar").innerHTML =
      buttons.map(function (b) {
        return '<button type="button" class="btn btn-sm' + (current === b[0] ? " btn-primary" : "") +
          '" data-release-doc="' + b[0] + '">' + b[1] + "</button>";
      }).join("") +
      '<button type="button" class="btn btn-sm btn-primary" id="btnPrintRelease"><i class="ti ti-printer"></i> Print / share</button>';
    $("releaseDoc").innerHTML = docs[current] || docs.certificate;
  }

  function emptyRow(colspan, message) {
    return '<tr><td class="left muted" colspan="' + colspan + '">' + escapeHtml(message) + "</td></tr>";
  }

  function renderEmpty() {
    $("kpis").innerHTML = "";
    persist();
    $("formula").innerHTML =
      "Enter the loan details on the left. The schedule, arrears and receipts are built only from what you capture — nothing is pre-filled or auto-paid.";
    $("arrearsIntro").textContent = "Enter loan details first, then record receipts on the Payments tab.";
    $("arrearsSummary").innerHTML = "<h3>Clearance statement</h3><p class=\"hint\">Waiting for loan details.</p>";
    $("paymentsSummary").innerHTML = "<h3>Receipts</h3><p class=\"hint\">Waiting for loan details.</p>";
    $("demandIntro").textContent = "Demand fees are optional. Enter loan details first, then capture a notice only if one was issued.";
    $("demandSummary").innerHTML = "<h3>Demand fees</h3><p class=\"hint\">Waiting for loan details.</p>";
    $("payHint").textContent = "Enter loan details before capturing a receipt.";
    $("payInstallment").innerHTML = "";

    $("scheduleTable").querySelector("thead").innerHTML = "";
    $("scheduleTable").querySelector("tbody").innerHTML =
      emptyRow(8, "No schedule yet. Fill in amount, tenure, rate, tracking fee and dates.");
    $("arrearsTable").querySelector("thead").innerHTML = "";
    $("arrearsTable").querySelector("tbody").innerHTML =
      emptyRow(3, "No arrears to show until a loan is captured.");
    $("paymentsTable").querySelector("thead").innerHTML = "";
    $("paymentsTable").querySelector("tbody").innerHTML =
      emptyRow(8, "No payments captured. Record a receipt after the loan is entered.");
    $("demandTable").querySelector("thead").innerHTML = "";
    $("demandTable").querySelector("tbody").innerHTML =
      emptyRow(4, "No demand fees captured. Record a demand notice after the loan is entered.");
    $("statementIntro").textContent = "Enter loan details to generate the client statement.";
    $("statementDoc").innerHTML =
      '<div class="statement-page statement-empty">Waiting for loan details. The statement is generated once the client and loan have been captured.</div>';
    if ($("releaseIntro")) {
      $("releaseIntro").textContent = "Enter loan details first. Logbook release starts automatically once the loan is COMPLETED / CLOSED.";
    }
    if ($("releaseSteps")) $("releaseSteps").innerHTML = "";
    if ($("releaseSummary")) $("releaseSummary").innerHTML = "<h3>Logbook release</h3><p class=\"hint\">Waiting for loan details.</p>";
    if ($("releaseToolbar")) $("releaseToolbar").innerHTML = "";
    if ($("releaseDoc")) {
      $("releaseDoc").innerHTML =
        '<div class="statement-page statement-empty">Waiting for loan details. Clearance documents are generated after Paid in Full.</div>';
    }
  }

  function render() {
    if (!$("loanForm")) return;
    if (!canViewScheduleServicing()) return;
    const loan = readLoan();
    if (!loan) {
      renderEmpty();
      return;
    }

    let paidPrincipal = 0;
    if (state.tab === "ontime") {
      paidPrincipal = loan.schedule.reduce(function (sum, row) {
        return cmpDate(row.dueDate, loan.asOf) <= 0 ? sum + row.principal : sum;
      }, 0);
    } else {
      let left = accountAsOf(loan, loan.asOf).paidToInstallment;
      loan.schedule.forEach(function (row) {
        if (cmpDate(row.dueDate, loan.asOf) > 0) return;
        const take = Math.min(row.principal, Math.max(0, left));
        paidPrincipal += take;
        left -= take;
      });
    }

    renderFormula(loan);
    renderOnTime(loan);
    renderArrears(loan);
    renderPayments(loan);
    renderDemandFees(loan);
    renderStatement(loan);
    renderRelease(loan);
    renderKpisFixed(loan, paidPrincipal);
    persist();
  }

  function renderKpisFixed(loan, paidPrincipal) {
    const c = loan.currency;
    const ontime = outstandingOnTime(loan);
    const arrears = arrearsAsOf(loan);
    const usingArrears = state.tab !== "ontime";
    const remainingPrincipal = loan.principal - paidPrincipal;
    const collected = collectedAsOf(loan);
    const closed = loanClosed(loan);
    const outstanding = closed ? 0 : usingArrears ? arrears.total : ontime.remainingPayable;
    const outstandingLabel = closed ? "Loan status COMPLETED" : usingArrears ? "Amount to clear today" : "Outstanding payable";
    const live = liveLoan();
    const rel = live && live.release;
    const demandTab = state.tab === "demand";
    const releaseTab = state.tab === "release";
    $("kpis").innerHTML =
      kpi(releaseTab ? "Release status" : demandTab ? "Demand fees charged" : state.tab === "payments" ? "Total received" : "Monthly installment",
        releaseTab ? (closed ? (rel && rel.status === "CLOSED_LOGBOOK_RELEASED" ? "LOGBOOK RELEASED" : "PAID IN FULL") : "WAITING") :
        money(demandTab ? arrears.chargedDemand : state.tab === "payments" ? collected.total : loan.installment, c)) +
      kpi(releaseTab ? "Workflow step" : demandTab ? "Paid toward demand" : state.tab === "payments" ? "Applied to installments" : "Total if paid on time",
        releaseTab ? (closed ? String((rel && rel.stage) || 3) + " / 8" : "—") :
        money(demandTab ? arrears.account.paidToDemand : state.tab === "payments" ? collected.toInstallment : loan.totalPayable, c)) +
      kpi(releaseTab ? "Outstanding" : demandTab ? "Demand remaining" : "Outstanding principal",
        money(releaseTab ? outstanding : demandTab ? arrears.demandTotal : remainingPrincipal, c), false, (releaseTab && outstanding > 0) || (demandTab && arrears.demandTotal > 0)) +
      kpi(outstandingLabel, closed ? "CLOSED" : usingArrears ? moneyPrecise(outstanding, c) : money(outstanding, c), true, usingArrears && arrears.total > 0 && !closed);
  }

  function showTab(name) {
    state.tab = name;
    document.querySelectorAll("#logbook-calc .calc-tab").forEach(function (btn) {
      const on = btn.getAttribute("data-tab") === name;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    $("view-ontime").classList.toggle("is-hidden", name !== "ontime");
    $("view-arrears").classList.toggle("is-hidden", name !== "arrears");
    $("view-payments").classList.toggle("is-hidden", name !== "payments");
    $("view-demand").classList.toggle("is-hidden", name !== "demand");
    $("view-statement").classList.toggle("is-hidden", name !== "statement");
    if ($("view-release")) $("view-release").classList.toggle("is-hidden", name !== "release");
    const calcOpen = $("tab-calculator") && $("tab-calculator").classList.contains("active");
    document.body.classList.toggle("is-statement", (name === "statement" || name === "release") && !!calcOpen);
    render();
  }

  function isoFromMaybe(value) {
    if (!value) return "";
    const s = String(value);
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    return "";
  }

  function setSourceNote(text) {
    const el = $("calc-source-note");
    if (el) el.textContent = text || "";
  }

  function loadFromLoan(loan) {
    if (!loan || !$("loanForm")) return false;
    const tenor = Number(loan.tenorMonths) || 12;
    const pif = loan.status === "PAID_IN_FULL" || loan.status === "CLOSED" || loan.status === "COMPLETED";
    const schedulePaid = (loan.schedule || []).length && (loan.schedule || []).every(function (r) { return r.status === "PAID"; });
    let payments = (loan.repaymentsHistory || []).map(function (r, i) {
      return {
        n: Math.min(i + 1, tenor),
        date: isoFromMaybe(r.date),
        amount: r.amount,
        ref: r.receiptNo || r.reference || "",
      };
    });
    if (pif && schedulePaid) {
      payments = (loan.schedule || []).map(function (r) {
        return {
          n: r.period || r.n,
          date: isoFromMaybe(r.paidDate || r.dueDate),
          amount: r.paidAmount || r.installment,
          ref: r.status === "PAID" ? "ON-TIME #" + (r.period || r.n) : (r.receiptNo || ""),
        };
      });
    }
    const lastPaid = payments.length ? payments[payments.length - 1].date : "";
    applySnapshot({
      clientName: loan.customer || "",
      logbookRef: [loan.reg, loan.vehicle].filter(Boolean).join(" · "),
      currency: "KES",
      principal: String(loan.disbursedAmount || ""),
      tenure: String(tenor),
      rate: String(loan.approvedRate || ""),
      trackingFee: String(loan.trackingFee || 0),
      penaltyRate: String(loan.penaltyRate || 5),
      graceDays: String(loan.graceDays || 7),
      disbursement: isoFromMaybe(loan.disbursementDate),
      firstDue: isoFromMaybe(loan.schedule && loan.schedule[0] && loan.schedule[0].dueDate),
      asOf: lastPaid || toISODate(new Date()),
      tab: pif ? "release" : (state.tab || "ontime"),
      accountNumber: loan.accountNumber || "",
      lmsStatus: loan.status || "",
      payments: payments,
      demandFees: [],
    });
    const pick = $("calcLoanPick");
    if (pick) pick.value = loan.accountNumber || "";
    setSourceNote(
      "Mapped from LMS account " + (loan.accountNumber || "") + " — " + (loan.customer || "client") +
      (pif ? ". Account is Paid in Full — open Logbook release for clearance documents and handover." : ".")
    );
    if (pif) showTab("release");
    else render();
    return true;
  }

  function loadFromApplication(app) {
    if (!canViewScheduleServicing()) return denyScheduleAccess();
    if (!app) return false;
    const data = typeof DataStore !== "undefined" ? DataStore.get() : null;
    const loan = data && (data.loans || []).find(function (x) { return x.appId === app.id; });
    if (!loan) return denyScheduleAccess("Schedule, arrears and statements are available after the facility is disbursed.");
    return loadFromLoan(loan);
  }

  function openFromWizard() {
    return denyScheduleAccess("Schedule, arrears and statements are available after the facility is disbursed.");
  }

  function canViewScheduleServicing() {
    return typeof App !== "undefined" && App.canViewScheduleServicing && App.canViewScheduleServicing();
  }

  function denyScheduleAccess(message) {
    alert(message || "Schedule, arrears and statements are available after disbursement for Overall Admin and Collection & Recovery.");
    if (typeof App !== "undefined") App.showTab("loans");
    return false;
  }

  function openForLoan(accountNumber) {
    if (!canViewScheduleServicing()) return denyScheduleAccess();
    const data = typeof DataStore !== "undefined" ? DataStore.get() : null;
    const loan = data && (data.loans || []).find(function (x) {
      return x.accountNumber === accountNumber;
    });
    if (loan) loadFromLoan(loan);
    if (typeof App !== "undefined") App.showTab("calculator");
  }

  function openForApplication(appId) {
    if (!canViewScheduleServicing()) return denyScheduleAccess();
    const data = typeof DataStore !== "undefined" ? DataStore.get() : null;
    const loan = data && (data.loans || []).find(function (x) { return x.appId === appId; });
    if (!loan) return denyScheduleAccess("Schedule, arrears and statements are available after the facility is disbursed.");
    return openForLoan(loan.accountNumber);
  }

  function refreshAccounts() {
    const pick = $("calcLoanPick");
    if (!pick || typeof DataStore === "undefined") return;
    if (!canViewScheduleServicing()) {
      pick.innerHTML = '<option value="">Available after disbursement for Overall Admin and Collection & Recovery…</option>';
      return;
    }
    const data = DataStore.get();
    const current = pick.value;
    const loans = data.loans || [];
    pick.innerHTML =
      '<option value="">Load a live (disbursed) account…</option>' +
      (loans.length ? '<optgroup label="LMS live accounts">' +
        loans.map(function (l) {
          return '<option value="' + escapeHtml(l.accountNumber) + '">' +
            escapeHtml(l.accountNumber + " · " + l.customer + (l.reg ? " · " + l.reg : "")) +
            "</option>";
        }).join("") + "</optgroup>" : "");
    if (current && pick.querySelector('option[value="' + current + '"]')) pick.value = current;
  }

  function bind() {
    if (!$("loanForm")) return;

    function bindAmountInput(id) {
      const el = $(id);
      if (!el) return;
      el.addEventListener("input", function () {
        const cursor = el.selectionStart;
        const digitsBefore = digitsOnly(el.value.slice(0, cursor)).length;
        el.value = formatAmountValue(el.value);
        let pos = el.value.length;
        let seen = 0;
        for (let i = 0; i < el.value.length; i++) {
          if (/\d/.test(el.value[i])) {
            seen++;
            if (seen === digitsBefore) {
              pos = i + 1;
              break;
            }
          }
        }
        if (digitsBefore === 0) pos = 0;
        el.setSelectionRange(pos, pos);
      });
    }

    bindAmountInput("principal");
    bindAmountInput("trackingFee");
    bindAmountInput("payAmount");
    bindAmountInput("demandAmount");
    bindAmountInput("stmtDemandAmount");

    $("loanForm").addEventListener("input", function (event) {
      if (state.hydrating) return;
      if (event.target.id === "disbursement" && $("firstDue")) {
        const disb = parseISODate($("disbursement").value);
        if (disb) $("firstDue").value = toISODate(FinEngine.firstOfNextMonth(disb));
      }
      if (event.target.id !== "asOf" && event.target.id !== "clientName" && event.target.id !== "logbookRef" && event.target.id !== "currency") {
        state.payments = [];
        state.demandFees = [];
        state.accountNumber = "";
        state.lmsStatus = "";
      }
      state.example = "";
      markExampleButtons();
      render();
    });

    document.querySelectorAll("#logbook-calc .calc-tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        showTab(tab.getAttribute("data-tab"));
      });
    });

    $("logbook-calc").addEventListener("click", function (event) {
      const tabBtn = event.target.closest("[data-calc-tab]");
      if (tabBtn) {
        showTab(tabBtn.getAttribute("data-calc-tab"));
        return;
      }
      const liveBtn = event.target.closest("[data-open-release]");
      if (liveBtn && typeof LMSModule !== "undefined") {
        LMSModule.openReleaseWorkflow(liveBtn.getAttribute("data-open-release"));
        return;
      }
      const docBtn = event.target.closest("[data-release-doc]");
      if (docBtn) {
        state.releaseDoc = docBtn.getAttribute("data-release-doc");
        const loan = readLoan();
        if (loan) renderRelease(loan);
        persist();
        return;
      }
      if (event.target.closest("#btnPrintRelease")) {
        if (!readLoan()) return;
        showTab("release");
        window.print();
      }
    });

    document.querySelectorAll("#calc-examples .calc-example").forEach(function (btn) {
      btn.addEventListener("click", function () {
        loadExample(btn.getAttribute("data-example"));
      });
    });

    $("btnGoPayments").addEventListener("click", function () {
      showTab("payments");
      $("payAmount").focus();
    });

    $("payInstallment").addEventListener("change", function () {
      const loan = readLoan();
      if (!loan) return;
      updatePayHint(loan);
    });

    $("paymentForm").addEventListener("submit", function (event) {
      event.preventDefault();
      const loan = readLoan();
      if (!loan) return;
      const n = Number($("payInstallment").value);
      const dateIso = $("payDate").value;
      const amount = parseAmount($("payAmount").value);
      const ref = $("payRef").value.trim();
      if (!n || !dateIso || !(amount > 0)) return;
      addPayment(n, parseISODate(dateIso), amount, ref);
      $("payAmount").value = "";
      $("payRef").value = "";
      render();
      const next = firstOpenInstallment(readLoan() || loan);
      $("payInstallment").value = String(next);
      updatePayHint(readLoan() || loan);
      $("payAmount").focus();
    });

    $("paymentsTable").addEventListener("click", function (event) {
      const btn = event.target.closest("[data-del-pay]");
      if (!btn) return;
      const id = Number(btn.getAttribute("data-del-pay"));
      state.payments = state.payments.filter(function (p) {
        return p.id !== id;
      });
      render();
    });

    function captureDemandFee(dateIso, amountValue, refValue, amountField, refField) {
      const loan = readLoan();
      if (!loan) return false;
      const amount = parseAmount(amountValue);
      if (!dateIso || !(amount > 0)) return false;
      addDemandFee(parseISODate(dateIso), amount, refValue);
      if (amountField) amountField.value = "";
      if (refField) refField.value = "";
      render();
      return true;
    }

    $("demandForm").addEventListener("submit", function (event) {
      event.preventDefault();
      if (captureDemandFee($("demandDate").value, $("demandAmount").value, $("demandRef").value.trim(), $("demandAmount"), $("demandRef"))) {
        $("demandAmount").focus();
      }
    });

    $("stmtDemandForm").addEventListener("submit", function (event) {
      event.preventDefault();
      if (captureDemandFee($("stmtDemandDate").value, $("stmtDemandAmount").value, $("stmtDemandRef").value.trim(), $("stmtDemandAmount"), $("stmtDemandRef"))) {
        $("stmtDemandAmount").focus();
      }
    });

    $("btnGoDemand").addEventListener("click", function () {
      showTab("demand");
      $("demandAmount").focus();
    });

    $("btnGoStatementFromDemand").addEventListener("click", function () {
      showTab("statement");
    });

    $("demandTable").addEventListener("click", function (event) {
      const btn = event.target.closest("[data-del-demand]");
      if (!btn) return;
      const id = Number(btn.getAttribute("data-del-demand"));
      state.demandFees = state.demandFees.filter(function (d) {
        return d.id !== id;
      });
      render();
    });

    $("btnClearPaid").addEventListener("click", function () {
      state.payments = [];
      render();
    });

    $("btnPrintStatement").addEventListener("click", function () {
      if (!readLoan()) return;
      showTab("statement");
      window.print();
    });

    const pick = $("calcLoanPick");
    if (pick) {
      pick.addEventListener("change", function () {
        if (!canViewScheduleServicing()) {
          denyScheduleAccess();
          pick.value = "";
          return;
        }
        if (!pick.value || typeof DataStore === "undefined") return;
        const data = DataStore.get();
        const loan = (data.loans || []).find(function (x) {
          return x.accountNumber === pick.value;
        });
        if (loan) {
          loadFromLoan(loan);
          return;
        }
        denyScheduleAccess("Schedule, arrears and statements are available after the facility is disbursed.");
        pick.value = "";
      });
    }
  }

  function boot() {
    if (!$("loanForm")) return;
    bind();
    refreshAccounts();
    const shared = readSaved();
    if (shared) applySnapshot(shared);
    markExampleButtons();
    if (shared && shared.tab && shared.tab !== "ontime") {
      showTab(shared.tab);
    } else {
      render();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  window.LogbookCalculator = {
    render: render,
    showTab: showTab,
    loadFromLoan: loadFromLoan,
    loadFromApplication: loadFromApplication,
    openForLoan: openForLoan,
    openForApplication: openForApplication,
    openFromWizard: openFromWizard,
    loadExample: loadExample,
    refreshAccounts: refreshAccounts,
  };
})();
