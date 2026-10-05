/**
 * Spectrum Credit Limited - General Ledger & Accounting Module
 * Double-entry journal entries, trial balance, and portfolio financial summary.
 */

const LedgerModule = {
  accounts: [
    '1010 - Bank Operating (Asset)',
    '1020 - M-Pesa Collections (Asset)',
    '1200 - Loans Receivable (Asset)',
    '1220 - Penalties Receivable (Asset)',
    '2010 - Accounts Payable (Liability)',
    '3010 - Retained Earnings (Equity)',
    '4010 - Interest Income (Revenue)',
    '4020 - Fee Income (Revenue)',
    '4030 - Late Payment Penalty Income (Revenue)',
    '5010 - Operating Expenses (Expense)'
  ],

  init() {
    this.renderLedgerTable();
  },

  escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[character]));
  },

  todayISO() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  },

  getJournalLines(journal, side) {
    const linesKey = side === 'debit' ? 'debitLines' : 'creditLines';
    if (Array.isArray(journal[linesKey])) return journal[linesKey];

    const account = side === 'debit' ? journal.debitAccount : journal.creditAccount;
    const amount = Number(side === 'debit' ? journal.debitAmount : journal.creditAmount) || 0;
    if (!account) return [];

    // Support older journal rows whose credit account contains split allocations.
    const parts = String(account).split('|').map(part => part.trim());
    if (parts.length > 1) {
      const parsed = parts.map(part => {
        const match = part.match(/^(.*?):\s*(?:KES\s*)?([\d,]+(?:\.\d+)?)/i);
        return match ? { account: match[1].trim(), amount: Number(match[2].replace(/,/g, '')) } : null;
      }).filter(line => line && Number.isFinite(line.amount));
      if (parsed.length && Math.abs(parsed.reduce((sum, line) => sum + line.amount, 0) - amount) < 0.01) return parsed;
    }
    return [{ account: String(account), amount }];
  },

  accountCode(account) {
    return String(account || '').match(/^(\d{4})\s*-/)?.[1] || '';
  },

  totalForAccount(journals, side, code) {
    return journals.reduce((total, journal) => total + this.getJournalLines(journal, side)
      .filter(line => this.accountCode(line.account) === code)
      .reduce((sum, line) => sum + (Number(line.amount) || 0), 0), 0);
  },

  renderLedgerTable() {
    const data = DataStore.get();
    const container = document.getElementById('ledger-table-container');
    if (!container) return;

    if (typeof App !== 'undefined' && App.cannotAccessLedger(data.activeRole)) {
      container.innerHTML = `
        <div style="text-align:center;padding:2.5rem;color:var(--text-tertiary)">
          <i class="ti ti-lock" style="font-size:32px;display:block;margin-bottom:8px;color:#0284C7"></i>
          Accounting is restricted to Finance Officer, Finance Manager, Overall Admin, and Super Admin.
        </div>`;
      return;
    }

    const journals = Array.isArray(data.generalLedger) ? data.generalLedger : [];
    const options = this.accounts.map(account => `<option value="${this.escapeHtml(account)}">${this.escapeHtml(account)}</option>`).join('');
    ['journal-debit-account', 'journal-credit-account'].forEach(id => {
      const select = document.getElementById(id);
      if (select && !select.options.length) select.innerHTML = `<option value="">Select account…</option>${options}`;
    });
    const dateInput = document.getElementById('journal-date');
    if (dateInput && !dateInput.value) dateInput.value = this.todayISO();

    const elDisb = document.getElementById('led-total-disbursed');
    const elRec = document.getElementById('led-total-receivable');
    const elInt = document.getElementById('led-interest-income');
    const elPen = document.getElementById('led-penalty-income');
    const totalDisbursed = journals.reduce((sum, journal) => {
      const isDisbursement = this.getJournalLines(journal, 'debit').some(line => this.accountCode(line.account) === '1200');
      return sum + (isDisbursement ? (Number(journal.debitAmount) || 0) : 0);
    }, 0);
    const totalInterestIncome = this.totalForAccount(journals, 'credit', '4010');
    const totalPenaltyIncome = this.totalForAccount(journals, 'credit', '4030');
    const totalActivePrincipal = (data.loans || []).reduce((sum, loan) => sum + (Number(loan.currentPrincipal) || 0), 0);
    if (elDisb) elDisb.textContent = FinEngine.kes(totalDisbursed);
    if (elRec) elRec.textContent = FinEngine.kes(totalActivePrincipal);
    if (elInt) elInt.textContent = FinEngine.kes(totalInterestIncome);
    if (elPen) elPen.textContent = FinEngine.kes(totalPenaltyIncome);

    this.renderTrialBalance(journals);

    container.innerHTML = !journals.length ? `
      <div style="text-align:center;padding:2rem;color:var(--text-tertiary)">No journal entries have been posted.</div>` : `
      <div class="table-responsive">
        <table class="tbl">
          <thead>
            <tr>
              <th style="width:110px">Journal Ref</th>
              <th style="width:130px">Timestamp</th>
              <th>Description &amp; Reference</th>
              <th>Debit Account</th>
              <th style="text-align:right">Debit (KES)</th>
              <th>Credit Account</th>
              <th style="text-align:right">Credit (KES)</th>
            </tr>
          </thead>
          <tbody>
            ${journals.slice().reverse().map(journal => `
              <tr>
                <td><span class="app-num">${this.escapeHtml(journal.id)}</span></td>
                <td style="font-size:11px;color:var(--text-secondary);font-family:var(--font-mono)">${this.escapeHtml(journal.date)}</td>
                <td>
                  <div style="font-weight:600">${this.escapeHtml(journal.description)}</div>
                  <div style="font-size:10.5px;color:var(--text-tertiary)">Source Ref: ${this.escapeHtml(journal.refId || '—')}</div>
                </td>
                <td style="color:#0284C7;font-weight:600;font-size:11.5px">${this.escapeHtml(journal.debitAccount)}</td>
                <td style="text-align:right;font-weight:700">${FinEngine.kes(Number(journal.debitAmount) || 0)}</td>
                <td style="color:#059669;font-weight:600;font-size:11.5px">${this.escapeHtml(journal.creditAccount)}</td>
                <td style="text-align:right;font-weight:700">${FinEngine.kes(Number(journal.creditAmount) || 0)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`;
  },

  renderTrialBalance(journals) {
    const container = document.getElementById('trial-balance-container');
    if (!container) return;

    const balances = new Map();
    let totalDebits = 0;
    let totalCredits = 0;
    journals.forEach(journal => {
      [['debit', 1], ['credit', -1]].forEach(([side, direction]) => {
        this.getJournalLines(journal, side).forEach(line => {
          const account = String(line.account || 'Unspecified account');
          const amount = Number(line.amount) || 0;
          if (!balances.has(account)) balances.set(account, 0);
          balances.set(account, balances.get(account) + amount * direction);
          if (side === 'debit') totalDebits += amount;
          else totalCredits += amount;
        });
      });
    });

    const rows = [...balances.entries()].filter(([, balance]) => Math.abs(balance) >= 0.005).sort(([a], [b]) => a.localeCompare(b));
    const balanced = Math.abs(totalDebits - totalCredits) < 0.01;
    container.innerHTML = !journals.length ? `
      <div style="text-align:center;padding:1.5rem;color:var(--text-tertiary)">Post journal entries to build the trial balance.</div>` : `
      <div class="table-responsive">
        <table class="tbl">
          <thead><tr><th>Account</th><th style="text-align:right">Debit balance (KES)</th><th style="text-align:right">Credit balance (KES)</th></tr></thead>
          <tbody>
            ${rows.map(([account, balance]) => `
              <tr>
                <td>${this.escapeHtml(account)}</td>
                <td style="text-align:right">${balance > 0 ? FinEngine.kes(balance) : '—'}</td>
                <td style="text-align:right">${balance < 0 ? FinEngine.kes(Math.abs(balance)) : '—'}</td>
              </tr>`).join('')}
          </tbody>
          <tfoot><tr style="font-weight:700;background:var(--bg-surface-secondary)">
            <td>Posted journal totals ${balanced ? '· Balanced' : '· Difference: ' + FinEngine.kes(Math.abs(totalDebits - totalCredits))}</td>
            <td style="text-align:right">${FinEngine.kes(totalDebits)}</td>
            <td style="text-align:right">${FinEngine.kes(totalCredits)}</td>
          </tr></tfoot>
        </table>
      </div>`;
  },

  postJournal(event) {
    event.preventDefault();
    const data = DataStore.get();
    if (typeof App !== 'undefined' && App.cannotAccessLedger(data.activeRole)) {
      alert('Your role cannot post accounting entries.');
      return;
    }

    const date = document.getElementById('journal-date')?.value || '';
    const description = document.getElementById('journal-description')?.value.trim() || '';
    const reference = document.getElementById('journal-reference')?.value.trim() || '';
    const debitAccount = document.getElementById('journal-debit-account')?.value || '';
    const creditAccount = document.getElementById('journal-credit-account')?.value || '';
    const amount = Number(document.getElementById('journal-amount')?.value);
    if (!date || !description || !debitAccount || !creditAccount || !Number.isFinite(amount) || amount <= 0) {
      alert('Enter a date, description, two accounts, and a positive amount.');
      return;
    }
    if (debitAccount === creditAccount) {
      alert('Choose different debit and credit accounts.');
      return;
    }

    const now = new Date();
    const year = date.slice(0, 4);
    const sequence = (data.generalLedger || []).reduce((max, journal) => {
      const match = String(journal.id || '').match(/^JRN-\d{4}-(\d+)$/);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0) + 1;
    const timestamp = `${date} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const journal = {
      id: `JRN-${year}-${String(sequence).padStart(3, '0')}`,
      date: timestamp,
      description,
      debitAccount,
      debitAmount: amount,
      creditAccount,
      creditAmount: amount,
      debitLines: [{ account: debitAccount, amount }],
      creditLines: [{ account: creditAccount, amount }],
      refId: reference || 'MANUAL'
    };
    data.generalLedger = Array.isArray(data.generalLedger) ? data.generalLedger : [];
    data.generalLedger.push(journal);
    if (!DataStore.save(data)) {
      data.generalLedger.pop();
      alert('Could not save the journal entry. Check available browser storage and try again.');
      return;
    }

    document.getElementById('accounting-journal-form')?.reset();
    const dateInput = document.getElementById('journal-date');
    if (dateInput) dateInput.value = this.todayISO();
    this.renderLedgerTable();
    alert(`Journal entry ${journal.id} posted. Debits and credits balance at ${FinEngine.kes(amount)}.`);
  },

  generateIncomeStatement() {
    const data = DataStore.get();
    const journals = Array.isArray(data.generalLedger) ? data.generalLedger : [];
    const reportContainer = document.getElementById('report-output');
    if (!reportContainer) return;

    let revenue = 0;
    let expenses = 0;

    journals.forEach(journal => {
      // Revenue: Interest Income, Fee Income, Penalty Income
      this.getJournalLines(journal, 'credit').forEach(line => {
        const code = this.accountCode(line.account);
        if (['4010', '4020', '4030'].includes(code)) {
          revenue += Number(line.amount) || 0;
        }
      });
      // Expenses: Operating Expenses
      this.getJournalLines(journal, 'debit').forEach(line => {
        const code = this.accountCode(line.account);
        if (['5010'].includes(code)) {
          expenses += Number(line.amount) || 0;
        }
      });
    });

    const netIncome = revenue - expenses;

    reportContainer.innerHTML = `
      <h3>Income Statement</h3>
      <table class="tbl">
        <tr><td style="font-weight:600">Total Revenue</td><td style="text-align:right">${FinEngine.kes(revenue)}</td></tr>
        <tr><td style="font-weight:600">Total Expenses</td><td style="text-align:right">${FinEngine.kes(expenses)}</td></tr>
        <tr style="font-weight:700"><td>Net Income</td><td style="text-align:right">${FinEngine.kes(netIncome)}</td></tr>
      </table>
    `;
  },

  generateBalanceSheet() {
    const data = DataStore.get();
    const journals = Array.isArray(data.generalLedger) ? data.generalLedger : [];
    const loans = Array.isArray(data.loans) ? data.loans : [];
    const reportContainer = document.getElementById('report-output');
    if (!reportContainer) return;

    let assets = 0;
    let liabilities = 0;
    let equity = 0;

    // Assets
    journals.forEach(journal => {
      this.getJournalLines(journal, 'debit').forEach(line => {
        const code = this.accountCode(line.account);
        if (['1010', '1020', '1200', '1220'].includes(code)) {
          assets += Number(line.amount) || 0;
        }
      });
    });

    // Liabilities and Equity
    journals.forEach(journal => {
      this.getJournalLines(journal, 'credit').forEach(line => {
        const code = this.accountCode(line.account);
        if (['2010'].includes(code)) {
          liabilities += Number(line.amount) || 0;
        }
        if (['3010'].includes(code)) {
          equity += Number(line.amount) || 0;
        }
      });
    });

    // Calculate current principal from loans
    const currentPrincipal = loans.reduce((sum, loan) => sum + (Number(loan.currentPrincipal) || 0), 0);
    assets += currentPrincipal;

    reportContainer.innerHTML = `
      <h3>Balance Sheet</h3>
      <table class="tbl">
        <tr><td colspan="2" style="font-weight:600">Assets</td></tr>
        <tr><td>Cash and Bank</td><td style="text-align:right">${FinEngine.kes(assets - currentPrincipal)}</td></tr>
        <tr><td>Loans Receivable</td><td style="text-align:right">${FinEngine.kes(currentPrincipal)}</td></tr>
        <tr style="font-weight:600"><td>Total Assets</td><td style="text-align:right">${FinEngine.kes(assets)}</td></tr>
        <tr><td colspan="2" style="font-weight:600">Liabilities & Equity</td></tr>
        <tr><td>Accounts Payable</td><td style="text-align:right">${FinEngine.kes(liabilities)}</td></tr>
        <tr><td>Retained Earnings</td><td style="text-align:right">${FinEngine.kes(equity)}</td></tr>
        <tr style="font-weight:600"><td>Total Liabilities & Equity</td><td style="text-align:right">${FinEngine.kes(liabilities + equity)}</td></tr>
      </table>
    `;
  },

  generateCashFlow() {
    const data = DataStore.get();
    const journals = Array.isArray(data.generalLedger) ? data.generalLedger : [];
    const reportContainer = document.getElementById('report-output');
    if (!reportContainer) return;

    let operatingCash = 0;
    let investingCash = 0;
    let financingCash = 0;

    journals.forEach(journal => {
      // Operating: Interest, Fees, Penalties, Expenses
      this.getJournalLines(journal, 'credit').forEach(line => {
        const code = this.accountCode(line.account);
        if (['4010', '4020', '4030'].includes(code)) {
          operatingCash += Number(line.amount) || 0;
        }
      });
      this.getJournalLines(journal, 'debit').forEach(line => {
        const code = this.accountCode(line.account);
        if (['5010'].includes(code)) {
          operatingCash -= Number(line.amount) || 0;
        }
      });
      // Investing: Loan disbursements
      this.getJournalLines(journal, 'debit').forEach(line => {
        const code = this.accountCode(line.account);
        if (['1200'].includes(code)) {
          investingCash -= Number(line.amount) || 0;
        }
      });
      // Financing: Could include equity, but for now, leave as 0
    });

    const netCashFlow = operatingCash + investingCash + financingCash;

    reportContainer.innerHTML = `
      <h3>Cash Flow Statement</h3>
      <table class="tbl">
        <tr><td colspan="2" style="font-weight:600">Operating Activities</td></tr>
        <tr><td>Cash from Operations</td><td style="text-align:right">${FinEngine.kes(operatingCash)}</td></tr>
        <tr><td colspan="2" style="font-weight:600">Investing Activities</td></tr>
        <tr><td>Loan Disbursements</td><td style="text-align:right">${FinEngine.kes(investingCash)}</td></tr>
        <tr><td colspan="2" style="font-weight:600">Financing Activities</td></tr>
        <tr><td>Financing Cash Flow</td><td style="text-align:right">${FinEngine.kes(financingCash)}</td></tr>
        <tr style="font-weight:700"><td>Net Cash Flow</td><td style="text-align:right">${FinEngine.kes(netCashFlow)}</td></tr>
      </table>
    `;
  },

  generateTrialBalance() {
    // Reuse existing renderTrialBalance logic
    const container = document.getElementById('report-output');
    if (!container) return;

    const data = DataStore.get();
    const journals = Array.isArray(data.generalLedger) ? data.generalLedger : [];

    const balances = new Map();
    let totalDebits = 0;
    let totalCredits = 0;
    journals.forEach(journal => {
      [['debit', 1], ['credit', -1]].forEach(([side, direction]) => {
        this.getJournalLines(journal, side).forEach(line => {
          const account = String(line.account || 'Unspecified account');
          const amount = Number(line.amount) || 0;
          if (!balances.has(account)) balances.set(account, 0);
          balances.set(account, balances.get(account) + amount * direction);
          if (side === 'debit') totalDebits += amount;
          else totalCredits += amount;
        });
      });
    });

    const rows = [...balances.entries()].filter(([, balance]) => Math.abs(balance) >= 0.005).sort(([a], [b]) => a.localeCompare(b));
    const balanced = Math.abs(totalDebits - totalCredits) < 0.01;

    container.innerHTML = `
      <h3>Trial Balance</h3>
      <table class="tbl">
        <thead><tr><th>Account</th><th style="text-align:right">Debit Balance (KES)</th><th style="text-align:right">Credit Balance (KES)</th></tr></thead>
        <tbody>
          ${rows.map(([account, balance]) => `
            <tr>
              <td>${this.escapeHtml(account)}</td>
              <td style="text-align:right">${balance > 0 ? FinEngine.kes(balance) : '—'}</td>
              <td style="text-align:right">${balance < 0 ? FinEngine.kes(Math.abs(balance)) : '—'}</td>
            </tr>`).join('')}
        </tbody>
        <tfoot><tr style="font-weight:700;background:var(--bg-surface-secondary)">
          <td>Totals ${balanced ? '· Balanced' : '· Difference: ' + FinEngine.kes(Math.abs(totalDebits - totalCredits))}</td>
          <td style="text-align:right">${FinEngine.kes(totalDebits)}</td>
          <td style="text-align:right">${FinEngine.kes(totalCredits)}</td>
        </tr></tfoot>
      </table>
    `;
  }
};

if (typeof window !== 'undefined') {
  window.LedgerModule = LedgerModule;
}
