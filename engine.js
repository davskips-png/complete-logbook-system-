/**
 * Spectrum Credit Limited - Core Financial Engine
 * Handles Amortization, Reducing Balance vs Flat Rate, Payment Waterfall,
 * Delinquency & PAR Classification, Credit Scoring, and Early Payoff Rebates.
 */

const FinEngine = {
  // Format KES currency
  kes(amount) {
    if (amount === null || amount === undefined || isNaN(amount)) return 'KES 0';
    return 'KES ' + Math.round(amount).toLocaleString('en-KE');
  },

  // Reducing Balance Monthly Installment (EMI)
  // r = monthly interest rate in percent (e.g., 4.5 or 5.0)
  calcReducingEMI(principal, monthlyRatePct, tenorMonths) {
    if (!principal || !tenorMonths) return 0;
    const r = monthlyRatePct / 100;
    if (r === 0) return principal / tenorMonths;
    const factor = Math.pow(1 + r, tenorMonths);
    return principal * ((r * factor) / (factor - 1));
  },

  // Flat Rate Monthly Installment
  calcFlatEMI(principal, annualRatePct, tenorMonths) {
    if (!principal || !tenorMonths) return 0;
    const totalInterest = principal * (annualRatePct / 100) * (tenorMonths / 12);
    return (principal + totalInterest) / tenorMonths;
  },

  parseISODate(iso) {
    if (!iso) return null;
    const parts = String(iso).slice(0, 10).split('-').map(Number);
    if (parts.length !== 3 || parts.some(n => !n)) return null;
    const date = new Date(parts[0], parts[1] - 1, parts[2]);
    return isNaN(date.getTime()) ? null : date;
  },

  toISODate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  },

  addCalendarMonths(date, months) {
    const y = date.getFullYear();
    const m = date.getMonth() + months;
    const day = date.getDate();
    const result = new Date(y, m, day);
    if (result.getDate() !== day) return new Date(y, m + 1, 0);
    return result;
  },

  startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  },

  addDays(date, days) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  },

  cmpDate(a, b) {
    return this.startOfDay(a) - this.startOfDay(b);
  },

  // The first installment is due exactly 30 days after disbursement.
  firstInstallmentDate(date) {
    return this.addDays(date, 30);
  },

  // Retained for compatibility with older callers.
  firstOfNextMonth(date) {
    return this.firstInstallmentDate(date);
  },

  coerceDate(value) {
    if (!value) return null;
    if (value instanceof Date) return isNaN(value.getTime()) ? null : this.startOfDay(value);
    return this.parseISODate(value);
  },

  // Spectrum logbook calculator: monthly flat interest + equal principal + tracking fee
  quoteLogbookFlat(principal, monthlyRatePct, tenorMonths, trackingFee = 0, startDate = null, firstDueDate = null) {
    const p = Math.round(Number(principal) || 0);
    const t = parseInt(tenorMonths, 10) || 0;
    const rate = (parseFloat(monthlyRatePct) || 0) / 100;
    const track = Math.max(0, Math.round(Number(trackingFee) || 0));
    if (!(p > 0) || t < 1) return null;

    const monthlyPrincipal = Math.round(p / t);
    const monthlyInterest = Math.round(p * rate);
    const installment = monthlyPrincipal + monthlyInterest + track;
    const totalInterest = monthlyInterest * t;
    const totalTracking = track * t;
    const totalPayable = p + totalInterest + totalTracking;
    const start = this.parseISODate(startDate) || new Date();
    const firstDue = this.parseISODate(firstDueDate) || this.firstInstallmentDate(start);

    const schedule = [];
    let remainingPrincipal = p;
    let remainingPayable = totalPayable;

    for (let n = 1; n <= t; n++) {
      const principalPart = n === t ? remainingPrincipal : monthlyPrincipal;
      const dueAmount = principalPart + monthlyInterest + track;
      remainingPrincipal -= principalPart;
      remainingPayable -= dueAmount;
      const due = this.addCalendarMonths(firstDue, n - 1);
      schedule.push({
        n,
        period: n,
        dueDate: this.toISODate(due),
        principal: principalPart,
        interest: monthlyInterest,
        tracking: track,
        installment: dueAmount,
        remainingPrincipal,
        remainingPayable,
        balance: remainingPrincipal
      });
    }

    return {
      monthlyPrincipal,
      monthlyInterest,
      trackingFee: track,
      installment,
      totalInterest,
      totalTracking,
      totalPayable,
      firstDueDate: this.toISODate(firstDue),
      schedule
    };
  },

  /**
   * Missed-installment penalty engine.
   *
   * Due date → installment is overdue immediately.
   * After grace days: first penalty = overdue installment × weekly %.
   * Each following week: previous penalty compounds (prev × (1 + %)) and is added.
   * When the next installment falls due it is added to arrears; weekly compounding
   * continues on the existing cycle. Once that installment's grace lapses, the next
   * weekly charge is % of (next installment + all arrears). Then the process repeats.
   */
  projectLogbookArrears({ schedule, penaltyRate, graceDays, asOf, payments = [], demandFees = [] }) {
    const rate = Number(penaltyRate) || 0;
    const grace = Math.max(0, Number(graceDays) || 0);
    asOf = this.coerceDate(asOf);
    if (!asOf) return null;

    const rows = (schedule || []).map((row) => ({
      n: row.n || row.period,
      dueDate: this.coerceDate(row.dueDate),
      installment: Number(row.installment) || 0
    })).filter((row) => row.n && row.dueDate);

    let remainingInst = 0;
    let remainingPen = 0;
    let remainingDemand = 0;
    let paidAmount = 0;
    let paidToPenalty = 0;
    let paidToInstallment = 0;
    let paidToDemand = 0;
    let chargedDemand = 0;
    let lastPenaltyAmount = 0;
    let highestIncludedN = 0;
    let currentN = 0;
    let nextPenaltyDate = null;

    const charges = [];
    const demandCharges = [];
    const rolls = [];
    const paymentAllocations = [];
    const byInstallment = {};

    rows.forEach((row) => {
      byInstallment[row.n] = {
        n: row.n,
        dueDate: row.dueDate,
        installment: row.installment,
        broughtForward: 0,
        combined: 0,
        remainingInstallment: row.installment,
        remainingPenalties: 0,
        outstanding: 0,
        charges: [],
        paidAmount: 0,
        paidToInstallment: 0,
        paidToPenalty: 0,
        rolledTo: null,
        rolledAmount: 0
      };
    });

    const events = [];
    rows.forEach((row) => {
      if (this.cmpDate(row.dueDate, asOf) > 0) return;
      events.push({ type: 'due', date: row.dueDate, n: row.n, amount: row.installment });
    });
    payments.forEach((p) => {
      const date = this.coerceDate(p.date);
      if (!date || !(p.amount > 0) || this.cmpDate(date, asOf) > 0) return;
      events.push({ type: 'pay', date, amount: Number(p.amount), id: p.id, n: p.n });
    });
    demandFees.forEach((d) => {
      const date = this.coerceDate(d.date);
      if (!date || !(d.amount > 0) || this.cmpDate(date, asOf) > 0) return;
      events.push({ type: 'demand', date, amount: Number(d.amount), id: d.id, ref: d.ref });
    });

    events.sort((a, b) => {
      const byDate = this.cmpDate(a.date, b.date);
      if (byDate !== 0) return byDate;
      const rank = { due: 0, demand: 1, pay: 2, penalty: 3 };
      return (rank[a.type] || 0) - (rank[b.type] || 0) || (a.id || 0) - (b.id || 0);
    });

    const maxPastGraceN = (onDate) => {
      let maxN = 0;
      rows.forEach((row) => {
        if (this.cmpDate(row.dueDate, onDate) > 0) return;
        // The first penalty is chargeable on the final day of the grace period.
        // For example, with a 7-day grace period after a 1st due date, the first
        // penalty is charged on the 7th (the 7th grace day), not the 8th.
        if (this.cmpDate(this.addDays(row.dueDate, Math.max(0, grace - 1)), onDate) <= 0) maxN = row.n;
      });
      return maxN;
    };

    const applyPay = (amount, n, meta) => {
      if (amount <= 0) return;
      const original = amount;
      paidAmount += amount;
      const st = byInstallment[n];
      if (st) st.paidAmount += amount;
      const toPen = Math.min(Math.max(0, remainingPen), amount);
      remainingPen -= toPen;
      paidToPenalty += toPen;
      if (st) st.paidToPenalty += toPen;
      amount -= toPen;
      const toDemand = Math.min(Math.max(0, remainingDemand), amount);
      remainingDemand -= toDemand;
      paidToDemand += toDemand;
      amount -= toDemand;
      const toInst = amount;
      remainingInst -= toInst;
      paidToInstallment += toInst;
      if (st) st.paidToInstallment += toInst;
      if (remainingPen <= 0) lastPenaltyAmount = 0;
      if (remainingInst + remainingPen <= 0) {
        nextPenaltyDate = null;
        lastPenaltyAmount = 0;
        highestIncludedN = 0;
      }
      paymentAllocations.push({
        id: meta && meta.id,
        n,
        date: meta && meta.date,
        amount: original,
        toPenalty: toPen,
        toDemand,
        toInstallment: toInst
      });
    };

    const applyPenalty = (date) => {
      const arrears = remainingInst + remainingPen;
      if (arrears <= 0) {
        lastPenaltyAmount = 0;
        return;
      }
      const pastGraceN = maxPastGraceN(date);
      if (pastGraceN <= 0) return;

      let amount;
      let mode;
      let base;
      if (lastPenaltyAmount <= 0 || pastGraceN > highestIncludedN) {
        amount = arrears * rate;
        base = arrears;
        mode = lastPenaltyAmount <= 0 ? 'first' : 'combined';
        highestIncludedN = pastGraceN;
      } else {
        amount = lastPenaltyAmount * (1 + rate);
        base = lastPenaltyAmount;
        mode = 'weekly';
      }
      if (!(amount > 0)) return;
      remainingPen += amount;
      lastPenaltyAmount = amount;
      const charge = {
        n: currentN || pastGraceN,
        date,
        amount,
        base,
        mode
      };
      charges.push(charge);
      if (byInstallment[charge.n]) byInstallment[charge.n].charges.push(charge);
    };

    const applyPenaltiesBefore = (limitDate, inclusive) => {
      if (!nextPenaltyDate) return;
      while (nextPenaltyDate && this.cmpDate(nextPenaltyDate, asOf) <= 0) {
        const cmp = this.cmpDate(nextPenaltyDate, limitDate);
        if (inclusive ? cmp > 0 : cmp >= 0) break;
        applyPenalty(new Date(nextPenaltyDate));
        nextPenaltyDate = this.addDays(nextPenaltyDate, 7);
      }
    };

    const startPenaltyCycle = (dueDate) => {
      if (remainingInst + remainingPen <= 0) return;
      if (nextPenaltyDate) return;
      // The first penalty is charged on the final day of the grace period.
      // A due date on the 1st with 7 grace days is charged on the 7th.
      nextPenaltyDate = this.addDays(dueDate, Math.max(0, grace - 1));
    };

    events.forEach((event) => {
      applyPenaltiesBefore(event.date, false);
      if (event.type === 'due') {
        const brought = remainingInst + remainingPen;
        if (currentN && brought > 0) {
          const prev = byInstallment[currentN];
          if (prev) {
            prev.rolledTo = event.n;
            prev.rolledAmount = brought;
          }
          rolls.push({
            from: currentN,
            to: event.n,
            date: event.date,
            balance: brought,
            nextInstallment: event.amount,
            combined: brought + event.amount
          });
        }
        remainingInst += event.amount;
        currentN = event.n;
        const st = byInstallment[event.n];
        if (st) {
          st.broughtForward = brought;
          st.combined = remainingInst + remainingPen;
        }
        startPenaltyCycle(event.date);
        return;
      }
      if (event.type === 'pay') {
        applyPay(event.amount, event.n, event);
        if (remainingInst + remainingPen > 0 && !nextPenaltyDate && currentN && byInstallment[currentN]) {
          startPenaltyCycle(byInstallment[currentN].dueDate);
        }
        return;
      }
      remainingDemand += event.amount;
      chargedDemand += event.amount;
      demandCharges.push({ date: event.date, amount: event.amount, ref: event.ref || '' });
    });

    applyPenaltiesBefore(asOf, true);

    let instLeft = Math.max(0, remainingInst);
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i];
      const st = byInstallment[row.n];
      if (!st) continue;
      if (this.cmpDate(row.dueDate, asOf) > 0) {
        st.remainingInstallment = row.installment;
        st.outstanding = 0;
        continue;
      }
      const take = Math.min(row.installment, instLeft);
      st.remainingInstallment = take;
      st.outstanding = take;
      instLeft -= take;
    }
    rolls.forEach((roll) => {
      const prev = byInstallment[roll.from];
      if (!prev) return;
      prev.rolledTo = roll.to;
      prev.rolledAmount = roll.balance;
      prev.remainingInstallment = 0;
      prev.remainingPenalties = 0;
      prev.outstanding = 0;
    });
    if (currentN && byInstallment[currentN]) {
      byInstallment[currentN].remainingInstallment = Math.max(0, remainingInst);
      byInstallment[currentN].remainingPenalties = remainingPen;
      byInstallment[currentN].outstanding = Math.max(0, remainingInst) + remainingPen;
    }

    const arrearsOutstanding = remainingInst + remainingPen;
    const outstanding = Math.max(0, arrearsOutstanding) + remainingDemand;
    const totalContract = rows.reduce((sum, row) => sum + row.installment, 0);
    const lastRow = rows[rows.length - 1];
    const matured = !!(lastRow && this.cmpDate(lastRow.dueDate, asOf) <= 0);
    const settled = remainingInst <= 0 && remainingPen <= 0 && remainingDemand <= 0;
    const prepaidInFull = remainingPen <= 0 && remainingDemand <= 0 && paidToInstallment >= totalContract - 0.5;
    const closed = !!(settled && (matured || prepaidInFull));

    let nextPenalty = null;
    if (arrearsOutstanding > 0 && nextPenaltyDate) {
      const pastGraceN = maxPastGraceN(nextPenaltyDate);
      const combined = lastPenaltyAmount > 0 && pastGraceN > highestIncludedN;
      const first = lastPenaltyAmount <= 0;
      const base = first || combined ? arrearsOutstanding : lastPenaltyAmount;
      const amount = first || combined ? arrearsOutstanding * rate : lastPenaltyAmount * (1 + rate);
      nextPenalty = {
        n: currentN,
        date: nextPenaltyDate,
        amount,
        base,
        mode: first ? 'first' : combined ? 'combined' : 'weekly',
        rollsOn: combined ? rows.find((r) => r.n === pastGraceN)?.dueDate : null
      };
    }

    return {
      remainingInstallment: Math.max(0, remainingInst),
      remainingPenalties: remainingPen,
      remainingDemand: remainingDemand,
      outstanding: Math.max(0, outstanding),
      charges,
      demandCharges,
      rolls,
      byInstallment,
      paidAmount,
      paidToInstallment,
      paidToPenalty,
      paidToDemand,
      chargedDemand,
      currentN,
      nextPenalty,
      lastPenaltyAmount,
      highestIncludedN,
      paymentAllocations,
      totalContract,
      closed,
      settled,
      status: closed ? 'COMPLETED' : (arrearsOutstanding > 0 ? 'IN_ARREARS' : 'CURRENT')
    };
  },

  // Generate complete amortization schedule
  generateAmortizationSchedule(principal, monthlyRatePct, tenorMonths, method = 'REDUCING', startDate = null) {
    const p = parseFloat(principal);
    const r = (parseFloat(monthlyRatePct) || 5) / 100;
    const t = parseInt(tenorMonths) || 12;
    const emi = method === 'FLAT'
      ? this.calcFlatEMI(p, monthlyRatePct * 12, t)
      : this.calcReducingEMI(p, monthlyRatePct, t);

    let bal = p;
    const rows = [];
    const baseDate = startDate ? new Date(startDate) : new Date();

    for (let i = 1; i <= t; i++) {
      const dueDate = new Date(baseDate);
      dueDate.setMonth(dueDate.getMonth() + i);

      let intAmt, prinAmt;
      if (method === 'FLAT') {
        intAmt = (p * (monthlyRatePct * 12 / 100) * (t / 12)) / t;
        prinAmt = emi - intAmt;
        bal = Math.max(0, bal - prinAmt);
      } else {
        intAmt = bal * r;
        prinAmt = i === t ? bal : emi - intAmt;
        bal = Math.max(0, bal - prinAmt);
      }

      rows.push({
        period: i,
        dueDate: dueDate.toISOString().slice(0, 10),
        installment: Math.round(emi),
        principal: Math.round(prinAmt),
        interest: Math.round(intAmt),
        balance: Math.round(bal),
        status: 'PENDING', // PENDING, PAID, PARTIAL, OVERDUE
        paidAmount: 0,
        paidDate: null,
        daysOverdue: 0
      });
    }

    return rows;
  },

  /**
   * Payment Waterfall Allocator
   * Allocation sequence:
   * 1. Penalties and late fees
   * 2. Overdue & current interest
   * 3. Principal balance reduction
   */
  allocatePayment(paymentAmount, currentPenalty, currentInterestDue, currentPrincipalDue) {
    let unallocated = parseFloat(paymentAmount) || 0;

    // 1. Clear Penalties
    const penaltyPaid = Math.min(unallocated, currentPenalty);
    unallocated -= penaltyPaid;
    const remainingPenalty = currentPenalty - penaltyPaid;

    // 2. Clear Interest
    const interestPaid = Math.min(unallocated, currentInterestDue);
    unallocated -= interestPaid;
    const remainingInterest = currentInterestDue - interestPaid;

    // 3. Clear Principal
    const principalPaid = Math.min(unallocated, currentPrincipalDue);
    unallocated -= principalPaid;
    const remainingPrincipal = currentPrincipalDue - principalPaid;

    return {
      penaltyPaid: Math.round(penaltyPaid),
      interestPaid: Math.round(interestPaid),
      principalPaid: Math.round(principalPaid),
      overpayment: Math.round(unallocated), // Extra funds credited to account
      remainingPenalty: Math.round(remainingPenalty),
      remainingInterest: Math.round(remainingInterest),
      remainingPrincipal: Math.round(remainingPrincipal)
    };
  },

  // Classify Portfolio-At-Risk (PAR) aging buckets
  classifyPAR(daysPastDue) {
    const dpd = parseInt(daysPastDue) || 0;
    if (dpd <= 0) return { bucket: 'PAR_0', label: 'Current (PAR 0)', class: 'b-par0', riskLevel: 'Normal' };
    if (dpd <= 30) return { bucket: 'PAR_1_30', label: 'Watchlist (1-30 DPD)', class: 'b-par1-30', riskLevel: 'Low' };
    if (dpd <= 60) return { bucket: 'PAR_31_60', label: 'Substandard (31-60 DPD)', class: 'b-par31-60', riskLevel: 'Medium' };
    if (dpd <= 90) return { bucket: 'PAR_61_90', label: 'Doubtful (61-90 DPD)', class: 'b-par61-90', riskLevel: 'High' };
    return { bucket: 'PAR_90_PLUS', label: 'Loss / NPL (90+ DPD)', class: 'b-par90plus', riskLevel: 'Critical' };
  },

  // Calculate Credit Scorecard & Risk Grade
  evaluateCreditRisk(params) {
    const {
      amount = 300000,
      valuation = 600000,
      monthlyIncome = 120000,
      existingDebt = 20000,
      vehicleYear = 2017,
      crbListed = false
    } = params;

    let score = 700; // Base score

    // LTV Impact
    const ltv = (amount / (valuation || 1)) * 100;
    if (ltv > 85) score -= 90;
    else if (ltv > 75) score -= 40;
    else if (ltv <= 60) score += 30;

    // Debt-to-Income (DTI)
    const proposedEMI = this.calcReducingEMI(amount, 5, 12);
    const totalObligations = existingDebt + proposedEMI;
    const dti = (totalObligations / (monthlyIncome || 1)) * 100;

    if (dti > 65) score -= 80;
    else if (dti > 50) score -= 40;
    else if (dti <= 35) score += 35;

    // Vehicle Age Impact (Logbook Collateral Health)
    const currentYear = new Date().getFullYear();
    const age = currentYear - (vehicleYear || 2017);
    if (age > 15) score -= 50;
    else if (age > 10) score -= 25;
    else if (age <= 6) score += 20;

    // CRB / Bureau check
    if (crbListed) score -= 120;
    else score += 25;

    // Cap between 300 and 850
    score = Math.max(300, Math.min(850, Math.round(score)));

    let grade, decision, maxLTVAllowed, recommendedRate;
    if (score >= 740) {
      grade = 'A (Prime)';
      decision = 'RECOMMENDED_APPROVAL';
      maxLTVAllowed = 80;
      recommendedRate = 4.5;
    } else if (score >= 660) {
      grade = 'B (Standard)';
      decision = 'RECOMMENDED_APPROVAL';
      maxLTVAllowed = 75;
      recommendedRate = 5.0;
    } else if (score >= 580) {
      grade = 'C (High Risk - Extra CPs)';
      decision = 'CONDITIONAL_APPROVAL';
      maxLTVAllowed = 65;
      recommendedRate = 5.5;
    } else {
      grade = 'D (Subprime / Decline)';
      decision = 'HIGH_RISK_DECLINE';
      maxLTVAllowed = 50;
      recommendedRate = 6.0;
    }

    return {
      score,
      grade,
      decision,
      ltv: Math.round(ltv),
      dti: Math.round(dti),
      proposedEMI: Math.round(proposedEMI),
      maxLTVAllowed,
      recommendedRate
    };
  },

  // Calculate Early Settlement / Payoff Quote with Unearned Interest Rebate
  calculateEarlySettlementQuote(loan) {
    const remainingPrincipal = loan.currentPrincipal || loan.amount;
    const accruedInterest = Math.round(remainingPrincipal * (loan.approvedRate / 100) * 0.5); // mid-month interest
    const unpaidPenalties = loan.unpaidPenalties || 0;
    const dischargeFee = 2500; // Logbook discharge processing fee
    const earlyPayoffDiscount = Math.round(remainingPrincipal * 0.01); // 1% rebate on prompt early exit

    const totalPayoff = remainingPrincipal + accruedInterest + unpaidPenalties + dischargeFee - earlyPayoffDiscount;

    return {
      remainingPrincipal,
      accruedInterest,
      unpaidPenalties,
      dischargeFee,
      earlyPayoffDiscount,
      totalPayoff: Math.max(0, Math.round(totalPayoff)),
      quoteValidDays: 7
    };
  },

  outstandingServicingBalance(loan) {
    return Math.max(0,
      (Number(loan?.currentPrincipal) || 0) +
      (Number(loan?.unpaidInterest) || 0) +
      (Number(loan?.unpaidPenalties) || 0)
    );
  },

  isPaidInFull(loan) {
    return this.outstandingServicingBalance(loan) <= 0.5;
  },

  hasReversedTransactions(loan) {
    return (loan?.repaymentsHistory || []).some(r => r.reversed || r.status === 'REVERSED');
  },

  RELEASE_STEPS: [
    { n: 1, key: 'reconcile', status: 'PAID_IN_FULL', label: 'Auto Reconciliation', short: 'Reconcile' },
    { n: 2, key: 'review', status: 'PENDING_CLOSURE_REVIEW', label: 'Closure Verification', short: 'Closure Review' },
    { n: 3, key: 'documents', status: 'DOCUMENTS_READY', label: 'Clearance Documents', short: 'Documents' },
    { n: 4, key: 'notify_teams', status: 'TEAMS_NOTIFIED', label: 'Notify Internal Teams', short: 'Notify Teams' },
    { n: 5, key: 'notify_customer', status: 'CUSTOMER_NOTIFIED', label: 'Customer Notification', short: 'Notify Client' },
    { n: 6, key: 'appointment', status: 'APPOINTMENT_BOOKED', label: 'Release Appointment', short: 'Appointment' },
    { n: 7, key: 'handover', status: 'HANDOVER_COMPLETE', label: 'Physical Handover', short: 'Handover' },
    { n: 8, key: 'closed', status: 'CLOSED_LOGBOOK_RELEASED', label: 'Closed · Logbook Released', short: 'Released' }
  ],

  CUSTOMER_RELEASE_SMS: 'Your loan has been fully repaid. Your logbook is ready for release. Please visit branch with your ID for collection.',

  reconcileFinalPayment(loan, payment = {}) {
    const outstanding = this.outstandingServicingBalance(loan);
    const amount = Number(payment.amount) || 0;
    const reversed = this.hasReversedTransactions(loan);
    const channel = String(payment.channel || '');
    const channelOk = /M-PESA|MPESA|BANK|RTGS|EFT|CASHIER|PAYBILL/i.test(channel);
    const matched = outstanding <= 0.5 || amount + 0.5 >= outstanding;
    return {
      outstanding,
      amount,
      matched,
      reversedTransactions: reversed,
      channelOk,
      paidInFull: matched && !reversed && outstanding <= Math.max(amount, 0) + 0.5
    };
  },

  createCollateralRelease(loan, payment = {}, ts = '') {
    const recon = this.reconcileFinalPayment(loan, payment);
    return {
      id: `REL-${loan.accountNumber}`,
      accountNumber: loan.accountNumber,
      customer: loan.customer,
      phone: loan.phone,
      idNumber: loan.idNumber || '',
      email: loan.email || '',
      vehicle: loan.vehicle,
      reg: loan.reg,
      vaultId: loan.collateralVaultId || '',
      stage: recon.paidInFull ? 2 : 1,
      status: recon.paidInFull ? 'PENDING_CLOSURE_REVIEW' : 'RECONCILIATION_FAILED',
      loanStatusAfter: recon.paidInFull ? 'PAID_IN_FULL' : (loan.status || 'ACTIVE'),
      reconciliation: {
        channel: payment.channel || '',
        reference: payment.reference || '',
        receiptNo: payment.receiptNo || '',
        amount: Number(payment.amount) || 0,
        outstandingBefore: recon.outstanding,
        matched: recon.matched,
        reversedTransactions: recon.reversedTransactions,
        channelOk: recon.channelOk,
        verifiedAt: recon.paidInFull ? ts : ''
      },
      checklist: {
        paymentsCleared: false,
        noChargebacks: false,
        noDuplicateBalances: false,
        identityVerified: false,
        reviewedBy: '',
        reviewedAt: ''
      },
      documents: {
        generatedAt: '',
        clearanceCertificate: false,
        finalStatement: false,
        releaseLetter: false,
        closureConfirmation: false
      },
      teamNotified: {
        operations: false,
        custody: false,
        branchManager: false,
        collections: false,
        at: ''
      },
      customerNotice: {
        sent: false,
        channel: 'SMS',
        message: this.CUSTOMER_RELEASE_SMS,
        at: ''
      },
      appointment: {
        method: '',
        branch: 'Nairobi CBD Branch',
        date: '',
        time: '10:00',
        bookedAt: ''
      },
      handover: {
        idVerified: false,
        idNumberPresented: loan.idNumber || '',
        releaseFormSigned: false,
        acknowledgementSigned: false,
        receivingCustomer: loan.customer || '',
        staffName: '',
        releasedAt: '',
        acknowledgementRef: '',
        uploads: this.emptyHandoverUploads()
      },
      log: recon.paidInFull ? [{
        at: ts,
        by: 'System',
        action: 'Paid in Full',
        note: `Final repayment ${payment.receiptNo || payment.reference || ''} reconciled. Account marked Paid in Full. Queued for closure review.`
      }] : []
    };
  },

  checklistComplete(release) {
    const c = release?.checklist || {};
    return !!(c.paymentsCleared && c.noChargebacks && c.noDuplicateBalances && c.identityVerified);
  },

  HANDOVER_UPLOADS: [
    { key: 'nationalId', label: 'National ID verified', hint: 'Front and back of the National ID presented at collection', accept: 'image/*,.pdf', icon: 'ti-id' },
    { key: 'releaseForm', label: 'Release forms signed', hint: 'Signed logbook release / discharge form', accept: 'image/*,.pdf', icon: 'ti-file-signature' },
    { key: 'acknowledgement', label: 'Customer acknowledgement receipt signed', hint: 'Signed customer acknowledgement of logbook collection', accept: 'image/*,.pdf', icon: 'ti-receipt' }
  ],

  emptyHandoverUploads() {
    return { nationalId: null, releaseForm: null, acknowledgement: null };
  },

  normalizeHandover(handover = {}, loan = {}) {
    const next = {
      idVerified: false,
      idNumberPresented: loan.idNumber || '',
      releaseFormSigned: false,
      acknowledgementSigned: false,
      receivingCustomer: loan.customer || '',
      staffName: '',
      releasedAt: '',
      acknowledgementRef: '',
      ...handover
    };
    next.uploads = {
      ...this.emptyHandoverUploads(),
      ...(handover.uploads || {})
    };
    return next;
  },

  handoverFileUploaded(file) {
    return !!(file && (file.name || file.fileName || file.dataUrl));
  },

  handoverUploadsComplete(release) {
    const uploads = this.normalizeHandover(release?.handover).uploads;
    return this.HANDOVER_UPLOADS.every(doc => this.handoverFileUploaded(uploads[doc.key]));
  },

  applyReleaseAction(release, action, payload = {}, actor = 'System', ts = '') {
    if (!release) return { ok: false, error: 'Missing release case' };
    const next = JSON.parse(JSON.stringify(release));
    const stamp = (act, note) => {
      next.log = next.log || [];
      next.log.push({ at: ts, by: actor, action: act, note: note || '' });
    };

    if (action === 'approve_checklist') {
      if (next.stage < 2) return { ok: false, error: 'Reconciliation must complete first' };
      next.checklist = { ...next.checklist, ...payload.checklist };
      if (!this.checklistComplete(next)) {
        return { ok: false, error: 'Complete the Finance/Operations checklist before approval' };
      }
      next.checklist.reviewedBy = actor;
      next.checklist.reviewedAt = ts;
      next.status = 'APPROVED_FOR_RELEASE';
      next.stage = 3;
      stamp('Approved for Release', 'Payments cleared, no chargebacks, no duplicate balances, customer identity verified.');
      return { ok: true, release: next };
    }

    if (action === 'generate_documents') {
      if (next.status !== 'APPROVED_FOR_RELEASE' && next.stage < 3) {
        return { ok: false, error: 'Approve closure review before generating documents' };
      }
      next.documents = {
        generatedAt: ts,
        clearanceCertificate: true,
        finalStatement: true,
        releaseLetter: true,
        closureConfirmation: true
      };
      next.status = 'DOCUMENTS_READY';
      next.stage = Math.max(next.stage, 4);
      stamp('Clearance documents generated', 'Loan Clearance Certificate, Final Statement, Logbook Release Letter, Account Closure Confirmation.');
      return { ok: true, release: next };
    }

    if (action === 'notify_teams') {
      if (!next.documents?.generatedAt) return { ok: false, error: 'Generate clearance documents first' };
      next.teamNotified = {
        operations: true,
        custody: true,
        branchManager: true,
        collections: true,
        at: ts
      };
      next.status = 'TEAMS_NOTIFIED';
      next.stage = Math.max(next.stage, 5);
      stamp('Internal teams notified', 'Operations, custody/document team, branch manager, and collections (stop follow-ups).');
      return { ok: true, release: next };
    }

    if (action === 'notify_customer') {
      if (!next.teamNotified?.at) return { ok: false, error: 'Notify internal teams first' };
      next.customerNotice = {
        sent: true,
        channel: payload.channel || 'SMS',
        message: payload.message || this.CUSTOMER_RELEASE_SMS,
        at: ts
      };
      next.status = 'CUSTOMER_NOTIFIED';
      next.stage = Math.max(next.stage, 6);
      stamp('Customer notified', next.customerNotice.message);
      return { ok: true, release: next };
    }

    if (action === 'book_appointment') {
      if (!next.customerNotice?.sent) return { ok: false, error: 'Notify the customer first' };
      const method = payload.method || 'BRANCH_PICKUP';
      if (method === 'BRANCH_PICKUP' && (!payload.date || !payload.branch)) {
        return { ok: false, error: 'Select branch and pickup date' };
      }
      next.appointment = {
        method,
        branch: payload.branch || next.appointment.branch,
        date: payload.date || '',
        time: payload.time || '10:00',
        bookedAt: ts
      };
      next.status = 'APPOINTMENT_BOOKED';
      next.stage = Math.max(next.stage, 7);
      stamp('Release appointment booked', method === 'COURIER'
        ? 'Courier delivery requested (future feature).'
        : `${next.appointment.branch} on ${next.appointment.date} ${next.appointment.time}`);
      return { ok: true, release: next };
    }

    if (action === 'complete_handover') {
      if (!next.appointment?.bookedAt) return { ok: false, error: 'Book a release appointment first' };
      const h = this.normalizeHandover({ ...next.handover, ...payload, uploads: { ...(next.handover?.uploads || {}), ...(payload.uploads || {}) } }, next);
      if (!this.handoverFileUploaded(h.uploads.nationalId)) {
        return { ok: false, error: 'Upload the verified National ID before handover' };
      }
      if (!this.handoverFileUploaded(h.uploads.releaseForm)) {
        return { ok: false, error: 'Upload the signed release forms before handover' };
      }
      if (!this.handoverFileUploaded(h.uploads.acknowledgement)) {
        return { ok: false, error: 'Upload the signed customer acknowledgement receipt before handover' };
      }
      h.idVerified = true;
      h.releaseFormSigned = true;
      h.acknowledgementSigned = true;
      if (!h.receivingCustomer || !h.staffName) {
        return { ok: false, error: 'Record receiving customer and staff handling release' };
      }
      h.releasedAt = ts;
      h.acknowledgementRef = h.acknowledgementRef || `ACK-${(next.accountNumber || '').slice(-4)}-${String(Date.now()).slice(-4)}`;
      next.handover = h;
      next.status = 'HANDOVER_COMPLETE';
      next.stage = Math.max(next.stage, 8);
      stamp('Physical handover completed', `ID ${h.idNumberPresented} verified. Files: ${h.uploads.nationalId.name}, ${h.uploads.releaseForm.name}, ${h.uploads.acknowledgement.name}. Acknowledgement ${h.acknowledgementRef}.`);
      return { ok: true, release: next };
    }

    if (action === 'close_and_release') {
      if (next.status !== 'HANDOVER_COMPLETE' && next.stage < 8) {
        return { ok: false, error: 'Complete physical handover first' };
      }
      next.status = 'CLOSED_LOGBOOK_RELEASED';
      next.stage = 8;
      next.loanStatusAfter = 'CLOSED';
      stamp('CLOSED → LOGBOOK RELEASED', `Released ${next.reg} to ${next.handover.receivingCustomer} by ${next.handover.staffName}.`);
      return { ok: true, release: next };
    }

    return { ok: false, error: 'Unknown release action' };
  }
};

if (typeof window !== 'undefined') {
  window.FinEngine = FinEngine;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = FinEngine;
}
