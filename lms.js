/**
 * Spectrum Credit Limited - Core Loan Management System (LMS) Module
 * Handles Active Loan Servicing, Amortization Schedule Tracking,
 * Repayment Cashier (M-Pesa & Bank Waterfall), Collections & PAR Aging,
 * Collateral Safe Vault, and GPS Telematics Management.
 */

const LMSModule = {
  init() {
    this.renderLoansTable();
  },

  canOperatePostDisbursement(role) {
    const activeRole = role || DataStore.get().activeRole;
    return typeof App !== 'undefined' && App.canViewScheduleServicing
      ? App.canViewScheduleServicing(activeRole)
      : ['OVERALL_ADMIN', 'SUPER_ADMIN', 'COLLECTION_OFFICER', 'COLLECTION_MANAGER'].includes(activeRole);
  },

  canOperateEngineCutoff(role) {
    const activeRole = role || DataStore.get().activeRole;
    return ['OVERALL_ADMIN', 'SUPER_ADMIN', 'FINANCE_MANAGER', 'COLLECTION_MANAGER'].includes(activeRole);
  },

  renderLoansTable() {
    const data = DataStore.get();
    const container = document.getElementById('loans-table-container');
    const showServicing = this.canOperatePostDisbursement(data.activeRole);
    if (!container) return;

    const q = (document.getElementById('loan-search')?.value || '').toLowerCase();
    const parFilter = document.getElementById('par-filter')?.value || '';

    let list = (data.loans || []).filter(l => {
      const matchQ = !q || l.accountNumber.toLowerCase().includes(q) || l.customer.toLowerCase().includes(q) || l.reg.toLowerCase().includes(q);
      const matchPar = !parFilter
        || l.parStatus === parFilter
        || (parFilter === 'ARREARS' && l.daysPastDue > 0)
        || (parFilter === 'PAID_IN_FULL' && (l.status === 'PAID_IN_FULL' || l.status === 'COMPLETED'))
        || (parFilter === 'CLOSED' && l.status === 'CLOSED');
      return matchQ && matchPar;
    });

    const countEl = document.getElementById('lms-active-count');
    const accountCount = Array.isArray(data.loans) ? data.loans.length : 0;
    if (countEl) countEl.textContent = `${accountCount} loan account${accountCount === 1 ? '' : 's'}`;

    if (!list.length) {
      container.innerHTML = `
        <div style="text-align:center;padding:2.5rem;color:var(--text-tertiary)">
          <i class="ti ti-folder-off" style="font-size:32px;display:block;margin-bottom:8px"></i>
          No loan accounts match the current filter.
        </div>`;
      return;
    }

    container.innerHTML = `
      <div class="table-responsive">
        <table class="tbl">
          <thead>
            <tr>
              <th style="width:120px">Account No.</th>
              <th>Customer</th>
              <th>Vehicle / Reg</th>
              <th>Original Loan</th>
              <th>Current Principal</th>
              <th>Next Due</th>
              <th>DPD / Aging</th>
              <th>Status</th>
              <th style="text-align:right">Action</th>
            </tr>
          </thead>
          <tbody>
            ${list.map(l => {
              const parInfo = FinEngine.classifyPAR(l.daysPastDue);
              return `
                <tr>
                  <td><span class="app-num">${l.accountNumber}</span></td>
                  <td>
                    <div style="font-weight:600">${l.customer}</div>
                    <div style="font-size:11px;color:var(--text-secondary)">${l.phone}</div>
                  </td>
                  <td>
                    <div>${l.vehicle}</div>
                    <div style="font-size:11px;color:var(--text-secondary);font-family:var(--font-mono)">${l.reg}</div>
                  </td>
                  <td>${FinEngine.kes(l.disbursedAmount)}</td>
                  <td style="font-weight:700;color:var(--brand-primary)">${FinEngine.kes(l.currentPrincipal)}</td>
                  <td style="font-size:11.5px;color:var(--text-secondary)">${l.nextDueDate}</td>
                  <td>
                    <span class="badge ${parInfo.class}">${parInfo.label}</span>
                    ${l.daysPastDue > 0 ? `<div style="font-size:10px;color:#DC2626;font-weight:600">${l.daysPastDue} days overdue</div>` : ''}
                  </td>
                  <td>
                    <span class="badge b-${l.status.toLowerCase()}">${l.status.replace(/_/g, ' ').toLowerCase()}</span>
                  </td>
                  <td style="text-align:right">
                    <button class="btn btn-sm btn-primary" onclick="LMSModule.openLoan360('${l.accountNumber}')">
                      <i class="ti ti-chart-bar"></i> Account 360
                    </button>
                    ${l.status === 'PAID_IN_FULL' || l.status === 'CLOSED' || l.release ? `
                      <button class="btn btn-sm btn-success" onclick="LMSModule.openReleaseWorkflow('${l.accountNumber}')" style="margin-left:4px">
                        <i class="ti ti-lock-open"></i> Release
                      </button>
                    ` : showServicing ? `
                      <button class="btn btn-sm btn-success" onclick="LMSModule.openCashierModal('${l.accountNumber}')" style="margin-left:4px">
                        <i class="ti ti-cash"></i> Pay
                      </button>
                    ` : ''}
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  },

  openLoan360(accountNumber) {
    const data = DataStore.get();
    const l = (data.loans || []).find(x => x.accountNumber === accountNumber);
    if (!l) return;

    data.selectedLoanId = accountNumber;
    DataStore.save(data);

    const vault = (data.collateralVault || []).find(v => v.vaultId === l.collateralVaultId || v.regNumber === l.reg);
    const parInfo = FinEngine.classifyPAR(l.daysPastDue);
    const showServicing = this.canOperatePostDisbursement(data.activeRole);
    const showEngineCutoff = this.canOperateEngineCutoff(data.activeRole);
    const payoffQuote = showServicing ? FinEngine.calculateEarlySettlementQuote(l) : { totalPayoff: 0 };
    const application = (data.applications || []).find(item => item.id === l.appId) || null;

    const container = document.getElementById('loan-detail-content');
    if (!container) return;

    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
        <div>
          <button class="btn btn-sm" onclick="App.showTab('loans')" style="margin-bottom:6px">
            <i class="ti ti-arrow-left"></i> Back to Loan Accounts
          </button>
          <div style="font-size:18px;font-weight:700;color:var(--brand-primary)">${l.customer}</div>
          <div style="font-size:12px;color:var(--text-secondary)">
            Account No: <span class="app-num">${l.accountNumber}</span> · Facility Ref: ${l.appId} · Status: <span class="badge ${parInfo.class}">${parInfo.label}</span>
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${showServicing && l.status !== 'CLOSED' && l.status !== 'PAID_IN_FULL' ? `
          <button class="btn btn-sm btn-success" onclick="LMSModule.openCashierModal('${l.accountNumber}')">
            <i class="ti ti-cash"></i> Process Repayment
          </button>` : ''}
          ${showServicing ? `
          <button class="btn btn-sm btn-primary" onclick="LogbookCalculator.openForLoan('${l.accountNumber}')">
            <i class="ti ti-calendar-stats"></i> Flat Schedule &amp; Statement
          </button>
          ` : ''}
          ${showServicing && l.status !== 'CLOSED' && l.status !== 'PAID_IN_FULL' ? `
          <button class="btn btn-sm btn-accent" onclick="LMSModule.showPayoffModal('${l.accountNumber}')">
            <i class="ti ti-calculator"></i> Early Payoff Quote
          </button>` : ''}
          ${showServicing ? `
          <button class="btn btn-sm" onclick="LMSModule.exportLoanStatementCSV('${l.accountNumber}')">
            <i class="ti ti-download"></i> Statement (CSV)
          </button>` : ''}
          ${FinEngine.isPaidInFull(l) || l.status === 'PAID_IN_FULL' || l.status === 'CLOSED' || l.release ? `
            <button class="btn btn-sm btn-success" onclick="LMSModule.openReleaseWorkflow('${l.accountNumber}')">
              <i class="ti ti-lock-open"></i> ${l.status === 'CLOSED' ? 'Logbook Release File' : 'Collateral Release'}
            </button>
          ` : ''}
          ${l.daysPastDue > 0 && !App.cannotAccessCollections(data.activeRole) ? `
            <button class="btn btn-sm btn-danger" onclick="LMSModule.showDemandNoticeModal('${l.accountNumber}')">
              <i class="ti ti-alert-triangle"></i> Statutory Notice
            </button>
          ` : ''}
        </div>
      </div>

      ${LMSModule.renderPaidInFullBanner(l)}
      ${l.daysPastDue > 0 || l.status === 'REPOSSESSED' ? LMSModule.renderCollectionsActionPanel(l, data) : ''}
      <!-- Financial Snapshot KPI Cards -->
      <div class="metrics-grid">
        <div class="metric-card">
          <div class="metric-top">
            <span class="metric-title">Outstanding Principal</span>
            <div class="metric-icon" style="background:#EFF6FF;color:#2563EB"><i class="ti ti-wallet"></i></div>
          </div>
          <div class="metric-value" style="color:#0F172A">${FinEngine.kes(l.currentPrincipal)}</div>
          <div class="metric-footer">Original: ${FinEngine.kes(l.disbursedAmount)}</div>
        </div>

        <div class="metric-card">
          <div class="metric-top">
            <span class="metric-title">Interest & Penalties</span>
            <div class="metric-icon" style="background:#FEF2F2;color:#DC2626"><i class="ti ti-clock-pause"></i></div>
          </div>
          <div class="metric-value" style="color:${l.unpaidPenalties > 0 ? '#DC2626' : '#0F172A'}">${FinEngine.kes((l.unpaidInterest || 0) + (l.unpaidPenalties || 0))}</div>
          <div class="metric-footer ${l.unpaidPenalties > 0 ? 'negative' : ''}">Penalties: ${FinEngine.kes(l.unpaidPenalties || 0)}</div>
        </div>

        <div class="metric-card">
          <div class="metric-top">
            <span class="metric-title">Total Repaid to Date</span>
            <div class="metric-icon" style="background:#ECFDF5;color:#059669"><i class="ti ti-circle-check"></i></div>
          </div>
          <div class="metric-value" style="color:#059669">${FinEngine.kes(l.totalPaid || 0)}</div>
          <div class="metric-footer positive">${(l.repaymentsHistory || []).length} Payments logged</div>
        </div>

        <div class="metric-card">
          <div class="metric-top">
            <span class="metric-title">Immediate Settlement</span>
            <div class="metric-icon" style="background:#FAF5FF;color:#7C3AED"><i class="ti ti-receipt"></i></div>
          </div>
          <div class="metric-value" style="color:#7C3AED">${FinEngine.kes(payoffQuote.totalPayoff)}</div>
          <div class="metric-footer">Includes 1% prompt rebate</div>
        </div>
      </div>

      <!-- Collateral & GPS Security Card -->
      <div class="card">
        <div class="card-header">
          <div class="card-title-group">
            <i class="ti ti-shield-lock" style="font-size:18px;color:#0284C7"></i>
            <span class="card-title">Collateral Security, Logbook Vault & GPS Tracking</span>
          </div>
          <span class="badge" style="background:#EFF6FF;color:#0284C7">Vault ID: ${l.collateralVaultId}</span>
        </div>
        <div class="card-body">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div>
              <div class="section-label" style="margin-top:0">Logbook Safe Custody</div>
              <div class="detail-row"><span class="detail-label">Vehicle Pledged</span><span class="detail-val">${l.vehicle}</span></div>
              <div class="detail-row"><span class="detail-label">Registration</span><span class="detail-val" style="font-family:var(--font-mono)">${l.reg}</span></div>
              <div class="detail-row"><span class="detail-label">Vault Storage Location</span><span class="detail-val">${vault?.location || 'Main Safe Vault'}</span></div>
              <div class="detail-row"><span class="detail-label">NTSA TIMS Caveat Ref</span><span class="detail-val" style="font-family:var(--font-mono);color:#0284C7">${vault?.ntsaCaveatRef || 'CAV-PENDING'}</span></div>
              <div class="detail-row"><span class="detail-label">Custody Officer</span><span class="detail-val">${vault?.custodian || 'Credit Admin'}</span></div>
            </div>

            <div>
              <div class="section-label" style="margin-top:0">GPS Telematics & Immobilizer</div>
              <div class="detail-row"><span class="detail-label">Tracker Unit ID</span><span class="detail-val" style="font-family:var(--font-mono)">${vault?.gpsDetails?.unitId || l.gpsTrackerId}</span></div>
              <div class="detail-row"><span class="detail-label">Last Signal Ping</span><span class="detail-val" style="color:#059669"><i class="ti ti-circle" style="font-size:8px"></i> ${vault?.gpsDetails?.lastPing || 'Online'}</span></div>
              <div class="detail-row"><span class="detail-label">Location</span><span class="detail-val">${vault?.gpsDetails?.currentLocation || 'Nairobi, Kenya'}</span></div>
              <div class="detail-row"><span class="detail-label">Engine / Battery Status</span><span class="detail-val">${vault?.gpsDetails?.engineStatus || 'IDLE'} (${vault?.gpsDetails?.batteryPct || 98}%)</span></div>
              <div class="detail-row">
                <span class="detail-label">Immobilizer Command</span>
                <span class="detail-val">
                  ${showEngineCutoff ? `<button class="btn btn-sm ${vault?.gpsDetails?.immobilizerState === 'REMOTE_CUTOFF_ACTIVE' ? 'btn-success' : 'btn-danger'}"
                    onclick="LMSModule.toggleImmobilizer('${l.accountNumber}')">
                    <i class="ti ti-power"></i> ${vault?.gpsDetails?.immobilizerState === 'REMOTE_CUTOFF_ACTIVE' ? 'Re-Enable Engine' : 'Cut-off Engine'}
                  </button>` : '<span style="font-size:11px;color:var(--text-tertiary)">Restricted</span>'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      ${showServicing ? `
      <!-- Amortization Schedule Table -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">Facility Amortization Schedule (${l.approvedRate}% p.m. ${l.amortizationMethod === 'FLAT' ? 'Flat Logbook' : 'Reducing Balance'})</span>
          <span style="font-size:11px;color:var(--text-secondary)">Tenor: ${l.tenorMonths} Months</span>
        </div>
        <div class="card-body" style="padding:0">
          <div class="table-responsive">
            <table class="tbl">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Due Date</th>
                  <th>Installment (KES)</th>
                  <th>Insurance allocation</th>
                  <th>Principal</th>
                  <th>Interest</th>
                  <th>Remaining Balance</th>
                  <th>Status</th>
                  <th>Paid Date</th>
                </tr>
              </thead>
              <tbody>
                ${(l.schedule || []).map(row => `
                  <tr style="${row.status === 'OVERDUE' ? 'background:#FEF2F2' : ''}">
                    <td>${row.period}</td>
                    <td style="font-family:var(--font-mono)">${row.dueDate}</td>
                    <td style="font-weight:600">${FinEngine.kes(row.installment)}</td>
                    <td>${row.insuranceAddition ? `<span style="color:#7C3AED;font-weight:600">${FinEngine.kes(row.insuranceAddition)}</span>` : '—'}</td>
                    <td>${FinEngine.kes(row.principal)}</td>
                    <td>${FinEngine.kes(row.interest)}</td>
                    <td style="font-weight:600">${FinEngine.kes(row.balance)}</td>
                    <td>
                      <span class="badge ${row.status === 'PAID' ? 'b-active' : row.status === 'OVERDUE' ? 'b-rejected' : 'b-submitted'}">
                        ${row.status}
                      </span>
                      ${row.daysOverdue > 0 ? `<span style="font-size:10px;color:#DC2626">(${row.daysOverdue}d overdue)</span>` : ''}
                    </td>
                    <td style="font-size:11px;color:var(--text-secondary)">${row.paidDate || '—'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      ` : ''}

      ${(l.collectionsLog || []).length ? `
      <div class="card">
        <div class="card-header">
          <div class="card-title-group">
            <i class="ti ti-phone-call" style="font-size:16px;color:#C2410C"></i>
            <span class="card-title">Collections & Recovery Action Log</span>
          </div>
          <span class="badge" style="background:#FFEDD5;color:#C2410C">${(l.collectionsLog || []).length} actions</span>
        </div>
        <div class="card-body" style="padding-top:0.5rem">
          ${[...l.collectionsLog].reverse().map(entry => `
            <div class="detail-row" style="padding:8px 0;align-items:flex-start">
              <div>
                <div style="font-weight:600;font-size:12px">${entry.action}</div>
                <div style="font-size:11px;color:var(--text-secondary)">${entry.note || ''} · By: ${entry.by}</div>
              </div>
              <div style="font-family:var(--font-mono);font-size:11px;color:var(--text-tertiary);white-space:nowrap">${entry.at}</div>
            </div>
          `).join('')}
        </div>
      </div>
      ` : ''}

      <!-- Repayment History & Receipts -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">Payment Receipts & Transaction Ledger</span>
          ${showServicing && l.status !== 'CLOSED' && l.status !== 'PAID_IN_FULL' ? `
          <button class="btn btn-sm btn-primary" onclick="LMSModule.openCashierModal('${l.accountNumber}')">
            <i class="ti ti-plus"></i> Add Payment
          </button>` : ''}
        </div>
        <div class="card-body" style="padding:0">
          ${(l.repaymentsHistory || []).length === 0 ? `
            <div style="text-align:center;padding:1.5rem;color:var(--text-tertiary)">
              No repayments logged yet. Use the Repayment Cashier to record M-Pesa or Bank payments.
            </div>
          ` : `
            <div class="table-responsive">
              <table class="tbl">
                <thead>
                  <tr>
                    <th>Receipt No.</th>
                    <th>Date</th>
                    <th>Channel & Ref</th>
                    <th>Amount Paid</th>
                    <th>Allocated Principal</th>
                    <th>Allocated Interest</th>
                    <th>Allocated Penalties</th>
                    <th style="text-align:right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  ${l.repaymentsHistory.map(r => `
                    <tr>
                      <td><span class="app-num">${r.receiptNo}</span></td>
                      <td>${r.date}</td>
                      <td>
                        <div style="font-weight:600">${r.channel}</div>
                        <div style="font-size:10.5px;color:var(--text-secondary);font-family:var(--font-mono)">${r.reference}</div>
                      </td>
                      <td style="font-weight:700;color:#059669">${FinEngine.kes(r.amount)}</td>
                      <td>${FinEngine.kes(r.allocatedPrincipal)}</td>
                      <td>${FinEngine.kes(r.allocatedInterest)}</td>
                      <td>${FinEngine.kes(r.allocatedPenalty)}</td>
                      <td style="text-align:right">
                        <button class="btn btn-sm" onclick="LMSModule.printReceipt('${l.accountNumber}', '${r.receiptNo}')">
                          <i class="ti ti-printer"></i> Receipt
                        </button>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `}
        </div>
      </div>

      ${application && typeof LOSModule !== 'undefined' ? `
      <div class="card kyc-documents-panel">
        <div class="card-header">
          <div class="card-title-group">
            <i class="ti ti-id-badge-2" style="color:var(--brand-accent);font-size:17px"></i>
            <span class="card-title">Borrower KYC &amp; Identity Documents</span>
            <span class="badge" style="background:#ECFDF5;color:#047857">${(application.documents || []).length} attached</span>
          </div>
        </div>
        <div class="card-body">
          ${LOSModule.renderKycDocumentCards(application.documents || [], application.id)}
        </div>
      </div>
      <div class="card kyc-documents-panel">
        <div class="card-header">
          <div class="card-title-group">
            <i class="ti ti-shield-check" style="color:#7C3AED;font-size:17px"></i>
            <span class="card-title">Risk Assessment Results</span>
          </div>
        </div>
        <div class="card-body">
          ${LOSModule.renderKycDocumentCards(
            (application.documents || []).filter(doc => ['crb_result', 'ntsa_result'].includes(doc.id)),
            application.id
          )}
        </div>
      </div>` : ''}

      ${typeof LOSModule !== 'undefined' ? LOSModule.renderInteractionLog(application, l) : ''}
    `;

    App.showTab('loan-detail', { skipDetail: true });
  },

  openCashierModal(accountNumber) {
    const data = DataStore.get();
    if (!this.canOperatePostDisbursement(data.activeRole)) {
      alert('Repayment processing is restricted to Overall Admin and Collection & Recovery roles.');
      return;
    }
    const l = (data.loans || []).find(x => x.accountNumber === accountNumber);
    if (!l) return;

    const modal = document.getElementById('cashier-modal');
    const content = document.getElementById('cashier-modal-content');
    if (!modal || !content) return;

    // Suggest current installment or overdue balance
    const nextInstallment = l.schedule?.find(s => s.status !== 'PAID')?.installment || 35000;
    const defaultAmt = (l.unpaidPenalties || 0) + (l.unpaidInterest || 0) + nextInstallment;

    content.innerHTML = `
      <div class="alert alert-info">
        <i class="ti ti-info-circle"></i>
        <span>Repayments automatically follow the standard financial waterfall: <strong>(1) Late Penalties & Fees → (2) Accrued Interest → (3) Principal Reduction</strong>.</span>
      </div>

      <div style="background:#F8FAFC;padding:12px;border-radius:8px;border:1px solid #E2E8F0;margin-bottom:1rem">
        <div style="display:flex;justify-content:space-between">
          <div>
            <div style="font-weight:700;color:var(--brand-primary)">${l.customer}</div>
            <div style="font-size:11px;color:var(--text-secondary)">Account: <span class="app-num">${l.accountNumber}</span> · Vehicle: ${l.reg}</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:11px;color:var(--text-secondary)">Current Principal</div>
            <div style="font-weight:700;color:#0F172A">${FinEngine.kes(l.currentPrincipal)}</div>
          </div>
        </div>
      </div>

      <div class="form-grid" style="margin-bottom:1rem">
        <div class="fg">
          <label>Repayment Channel</label>
          <select id="pay-channel">
            <option value="M-PESA (Paybill 400200)">M-PESA (Paybill 400200)</option>
            <option value="NCBA Bank Transfer / RTGS">NCBA Bank Transfer / RTGS</option>
            <option value="Direct Cashier Counter">Direct Cashier Counter</option>
          </select>
        </div>
        <div class="fg">
          <label>Payment Amount (KES)</label>
          <input type="number" id="pay-amount" value="${defaultAmt}" oninput="LMSModule.previewWaterfall('${l.accountNumber}')">
        </div>
      </div>

      <div class="form-grid" style="margin-bottom:1rem">
        <div class="fg">
          <label>Sender Mobile / Account Ref</label>
          <input id="pay-sender" value="${l.phone}">
        </div>
        <div class="fg">
          <label>Transaction Reference No.</label>
          <div style="display:flex;gap:6px">
            <input id="pay-ref" value="QW${Math.floor(10000000 + Math.random() * 90000000)}">
            <button class="btn btn-sm" onclick="document.getElementById('pay-ref').value = 'QW' + Math.floor(10000000 + Math.random() * 90000000)">Gen</button>
          </div>
        </div>
      </div>

      <!-- Live Waterfall Breakdown Preview -->
      <div class="section-label">Waterfall Allocation Breakdown</div>
      <div id="waterfall-preview-box" style="background:#F1F5F9;padding:12px;border-radius:8px;margin-bottom:1.25rem">
        <!-- populated dynamically -->
      </div>

      <div style="display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap">
        <button class="btn" onclick="document.getElementById('cashier-modal').classList.remove('active')">Cancel</button>
        <button class="btn" style="background:#00A859;color:white;border-color:#00A859" onclick="LMSModule.triggerSTKPush('${l.accountNumber}')">
          <i class="ti ti-device-mobile"></i> ⚡ Send M-Pesa STK Push
        </button>
        <button class="btn btn-success" onclick="LMSModule.executePayment('${l.accountNumber}')">
          <i class="ti ti-check"></i> Post Payment (Manual C2B)
        </button>
      </div>
    `;

    modal.classList.add('active');
    this.previewWaterfall(l.accountNumber);
  },

  previewWaterfall(accountNumber) {
    const data = DataStore.get();
    const l = (data.loans || []).find(x => x.accountNumber === accountNumber);
    if (!l) return;

    const amt = parseFloat(document.getElementById('pay-amount')?.value) || 0;
    const penDue = l.unpaidPenalties || 0;
    const intDue = l.unpaidInterest || Math.round(l.currentPrincipal * (l.approvedRate / 100));
    const nextInstallment = l.schedule?.find(s => s.status !== 'PAID')?.principal || 20000;

    const allocation = FinEngine.allocatePayment(amt, penDue, intDue, nextInstallment);
    const box = document.getElementById('waterfall-preview-box');
    if (!box) return;

    box.innerHTML = `
      ${amt + 0.5 >= FinEngine.outstandingServicingBalance(l) && FinEngine.outstandingServicingBalance(l) > 0 ? `
        <div class="alert alert-success" style="margin-bottom:10px">
          <i class="ti ti-lock-open"></i>
          <span>This amount clears the account. Posting will mark it <strong>Paid in Full</strong> and start automated logbook release.</span>
        </div>
      ` : ''}
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;text-align:center">
        <div>
          <div style="font-size:10.5px;color:var(--text-secondary)">1. Late Penalties</div>
          <div style="font-size:14px;font-weight:700;color:${allocation.penaltyPaid > 0 ? '#DC2626' : '#0F172A'}">${FinEngine.kes(allocation.penaltyPaid)}</div>
          <div style="font-size:10px;color:var(--text-tertiary)">Left: ${FinEngine.kes(allocation.remainingPenalty)}</div>
        </div>
        <div>
          <div style="font-size:10.5px;color:var(--text-secondary)">2. Accrued Interest</div>
          <div style="font-size:14px;font-weight:700;color:#0284C7">${FinEngine.kes(allocation.interestPaid)}</div>
          <div style="font-size:10px;color:var(--text-tertiary)">Left: ${FinEngine.kes(allocation.remainingInterest)}</div>
        </div>
        <div>
          <div style="font-size:10.5px;color:var(--text-secondary)">3. Principal Reduction</div>
          <div style="font-size:14px;font-weight:700;color:#059669">${FinEngine.kes(allocation.principalPaid)}</div>
          <div style="font-size:10px;color:var(--text-tertiary)">New Bal: ${FinEngine.kes(Math.max(0, l.currentPrincipal - allocation.principalPaid))}</div>
        </div>
        <div>
          <div style="font-size:10.5px;color:var(--text-secondary)">Overpayment / Credit</div>
          <div style="font-size:14px;font-weight:700;color:#7C3AED">${FinEngine.kes(allocation.overpayment)}</div>
          <div style="font-size:10px;color:var(--text-tertiary)">Prepayment</div>
        </div>
      </div>
    `;
  },

  executePayment(accountNumber) {
    const data = DataStore.get();
    if (!this.canOperatePostDisbursement(data.activeRole)) {
      alert('Payment posting is restricted to Overall Admin and Collection & Recovery roles.');
      return;
    }
    const l = (data.loans || []).find(x => x.accountNumber === accountNumber);
    if (!l) return;

    const amt = parseFloat(document.getElementById('pay-amount')?.value) || 0;
    if (amt <= 0) {
      alert('Please enter a valid repayment amount.');
      return;
    }

    const channel = document.getElementById('pay-channel')?.value || 'M-PESA (Paybill 400200)';
    const ref = document.getElementById('pay-ref')?.value || 'TX-998811';
    const today = new Date().toISOString().slice(0, 10);
    const nowTime = new Date().toTimeString().slice(0, 5);

    const penDue = l.unpaidPenalties || 0;
    const intDue = l.unpaidInterest || Math.round(l.currentPrincipal * (l.approvedRate / 100));
    const pendingPeriod = l.schedule?.find(s => s.status !== 'PAID');
    const prinDue = pendingPeriod ? pendingPeriod.principal : l.currentPrincipal;

    const alloc = FinEngine.allocatePayment(amt, penDue, intDue, prinDue);

    // Update Loan State
    l.unpaidPenalties = alloc.remainingPenalty;
    l.unpaidInterest = alloc.remainingInterest;
    l.currentPrincipal = Math.max(0, l.currentPrincipal - alloc.principalPaid - alloc.overpayment);
    l.totalPaid = (l.totalPaid || 0) + amt;

    // Update Amortization Schedule
    if (pendingPeriod) {
      const dueNow = pendingPeriod.installment + penDue;
      if (amt + 0.5 >= dueNow || amt + 0.5 >= pendingPeriod.installment) {
        pendingPeriod.status = 'PAID';
        pendingPeriod.daysOverdue = 0;
      } else {
        pendingPeriod.status = 'PARTIAL';
      }
      pendingPeriod.paidAmount = (pendingPeriod.paidAmount || 0) + amt;
      pendingPeriod.paidDate = today;
    }

    // Recalculate DPD & Status
    if (FinEngine.isPaidInFull(l)) {
      (l.schedule || []).forEach(row => {
        if (row.status !== 'PAID') {
          row.status = 'PAID';
          row.paidDate = row.paidDate || today;
        }
      });
      l.daysPastDue = 0;
      l.parStatus = 'PAR_0';
      l.nextDueDate = null;
    } else {
      l.daysPastDue = Math.max(0, l.daysPastDue - 30);
      l.parStatus = FinEngine.classifyPAR(l.daysPastDue).bucket;
      if (l.daysPastDue === 0) l.status = 'ACTIVE';
    }

    const receiptNo = `REC-${Date.now().toString().slice(-6)}`;
    const newReceipt = {
      receiptNo,
      date: `${today} ${nowTime}`,
      amount: amt,
      channel,
      reference: ref,
      allocatedPrincipal: alloc.principalPaid + alloc.overpayment,
      allocatedInterest: alloc.interestPaid,
      allocatedPenalty: alloc.penaltyPaid
    };

    l.repaymentsHistory = l.repaymentsHistory || [];
    l.repaymentsHistory.unshift(newReceipt);

    // Notify Finance/Collections of large repayments or clearing accounts
    data.notifications = data.notifications || [];
    if (FinEngine.isPaidInFull(l)) {
      data.notifications.unshift({
        id: Date.now() + Math.floor(Math.random() * 99),
        role: 'FINANCE_OFFICER',
        message: `Account ${l.accountNumber} (${l.customer}) paid in full via ${channel}. Closure review required.`,
        appId: accountNumber,
        time: `${today} ${nowTime}`,
        read: false
      });
    } else if (amt >= 100000 || l.daysPastDue > 0) {
      data.notifications.unshift({
        id: Date.now() + Math.floor(Math.random() * 99),
        role: 'FINANCE_OFFICER',
        message: `Repayment ${FinEngine.kes(amt)} received on ${l.accountNumber} (${l.customer}) via ${channel}.`,
        appId: accountNumber,
        time: `${today} ${nowTime}`,
        read: false
      });
    }

    // Double-Entry Ledger Entry
    data.generalLedger = data.generalLedger || [];
    data.generalLedger.unshift({
      id: `JRN-${Date.now().toString().slice(-6)}`,
      date: `${today} ${nowTime}`,
      description: `Repayment received on ${l.accountNumber} (${l.customer}) via ${channel}`,
      debitAccount: channel.includes('M-PESA') ? '1020 - M-Pesa Collections (Asset)' : '1010 - NCBA Bank (Asset)',
      debitAmount: amt,
      creditAccount: `1200 - Loans Principal: ${FinEngine.kes(alloc.principalPaid + alloc.overpayment)} | 4010 - Interest: ${FinEngine.kes(alloc.interestPaid)} | 4030 - Penalties: ${FinEngine.kes(alloc.penaltyPaid)}`,
      creditAmount: amt,
      refId: receiptNo
    });

    DataStore.save(data);

    document.getElementById('cashier-modal').classList.remove('active');

    if (FinEngine.isPaidInFull(l)) {
      this.initiateCollateralRelease(accountNumber, newReceipt);
      return;
    }

    alert(`Payment of ${FinEngine.kes(amt)} posted successfully! Receipt ${receiptNo} issued.`);
    this.openLoan360(accountNumber);
    this.renderLoansTable();
    App.updateTopMetrics();
  },

  toggleImmobilizer(accountNumber) {
    const data = DataStore.get();
    if (!this.canOperateEngineCutoff(data.activeRole)) {
      alert('Engine cut-off is restricted to Overall Admin and Collection & Recovery Manager.');
      return;
    }
    const l = (data.loans || []).find(x => x.accountNumber === accountNumber);
    const vault = (data.collateralVault || []).find(v => v.vaultId === l?.collateralVaultId || v.regNumber === l?.reg);
    if (!vault || !vault.gpsDetails) return;

    const isCut = vault.gpsDetails.immobilizerState === 'REMOTE_CUTOFF_ACTIVE';
    vault.gpsDetails.immobilizerState = isCut ? 'DISENGAGED' : 'REMOTE_CUTOFF_ACTIVE';
    vault.gpsDetails.engineStatus = isCut ? 'RUNNING' : 'ENGINE_OFF_CUTOFF';

    DataStore.save(data);
    alert(`Remote Command Sent to GPS Unit ${vault.gpsDetails.unitId} for Vehicle ${l.reg}: Engine Immobilizer is now ${vault.gpsDetails.immobilizerState}`);
    this.openLoan360(accountNumber);
  },

  showPayoffModal(accountNumber) {
    const data = DataStore.get();
    if (!this.canOperatePostDisbursement(data.activeRole)) {
      alert('Early payoff quotes are restricted to Overall Admin and Collection & Recovery roles.');
      return;
    }
    const l = (data.loans || []).find(x => x.accountNumber === accountNumber);
    if (!l) return;

    const quote = FinEngine.calculateEarlySettlementQuote(l);
    const modal = document.getElementById('offer-letter-modal');
    const content = document.getElementById('offer-letter-content');
    if (!modal || !content) return;

    content.innerHTML = `
      <div style="text-align:center;border-bottom:2px solid #0F172A;padding-bottom:12px;margin-bottom:16px">
        <div style="font-size:20px;font-weight:800;color:#0F172A">SPECTRUM CREDIT LIMITED</div>
        <div style="font-size:11px;color:#475569">Official Early Loan Settlement & Payoff Statement</div>
      </div>

      <div style="display:flex;justify-content:space-between;margin-bottom:16px">
        <div>
          <strong>CUSTOMER:</strong> ${l.customer}<br>
          <strong>ACCOUNT:</strong> ${l.accountNumber}<br>
          <strong>SECURITY:</strong> ${l.vehicle} (${l.reg})
        </div>
        <div style="text-align:right">
          <strong>QUOTE DATE:</strong> ${new Date().toLocaleDateString('en-GB')}<br>
          <strong>VALIDITY:</strong> 7 Calendar Days<br>
          <strong>STATUS:</strong> Valid & Binding
        </div>
      </div>

      <table class="tbl" style="margin-bottom:16px;border:1px solid #CBD5E1">
        <tr><td style="font-weight:600;width:240px">Outstanding Principal Balance:</td><td style="font-weight:700">${FinEngine.kes(quote.remainingPrincipal)}</td></tr>
        <tr><td style="font-weight:600">Accrued Interest to Date:</td><td>${FinEngine.kes(quote.accruedInterest)}</td></tr>
        <tr><td style="font-weight:600">Unpaid Late Fees / Penalties:</td><td style="color:#DC2626">${FinEngine.kes(quote.unpaidPenalties)}</td></tr>
        <tr><td style="font-weight:600">Logbook Discharge & Caveat Lifting Fee:</td><td>${FinEngine.kes(quote.dischargeFee)}</td></tr>
        <tr style="color:#059669"><td style="font-weight:600">Prompt Early Settlement Discount (1% Rebate):</td><td>- ${FinEngine.kes(quote.earlyPayoffDiscount)}</td></tr>
        <tr style="background:#F1F5F9;font-size:13.5px"><td style="font-weight:700">TOTAL NET PAYOFF SUM REQUIRED:</td><td style="font-weight:800;color:#0284C7">${FinEngine.kes(quote.totalPayoff)}</td></tr>
      </table>

      <p style="font-size:11.5px;color:#475569;margin-bottom:20px">
        Upon receipt of the net settlement sum above, Spectrum Credit will initiate immediate release of Original Logbook from safe vault custody and lodge a formal Caveat Withdrawal Notice with NTSA TIMS.
      </p>

      <div style="display:flex;justify-content:flex-end;gap:10px">
        <button class="btn" onclick="document.getElementById('offer-letter-modal').classList.remove('active')">Close</button>
        <button class="btn btn-primary" onclick="window.print()"><i class="ti ti-printer"></i> Print Official Payoff Quote</button>
      </div>
    `;

    modal.classList.add('active');
  },

  showDemandNoticeModal(accountNumber) {
    const data = DataStore.get();
    const l = (data.loans || []).find(x => x.accountNumber === accountNumber);
    if (!l) return;

    const modal = document.getElementById('offer-letter-modal');
    const content = document.getElementById('offer-letter-content');
    if (!modal || !content) return;

    const overdueAmt = (l.unpaidPenalties || 0) + (l.unpaidInterest || 0) + 35000;
    l.noticeStage = Math.max(l.noticeStage || 0, 2);
    this._stampCollection(l, data, 'Statutory demand issued', '14-day notice of default generated for print and service.');
    l.assignedCollectionsRole = 'COLLECTION_MANAGER';
    DataStore.save(data);

    content.innerHTML = `
      <div style="text-align:center;border-bottom:2px solid #DC2626;padding-bottom:12px;margin-bottom:16px">
        <div style="font-size:20px;font-weight:800;color:#DC2626">SPECTRUM CREDIT LIMITED — LEGAL RECOVERIES</div>
        <div style="font-size:11px;color:#475569">P.O Box 48921-00100 Nairobi, Kenya · Tel: +254 20 765 4329</div>
      </div>

      <div style="display:flex;justify-content:space-between;margin-bottom:16px">
        <div>
          <strong>TO:</strong> ${l.customer}<br>
          <strong>CELL:</strong> ${l.phone}<br>
          <strong>ID NO:</strong> ${l.idNumber || '—'}
        </div>
        <div style="text-align:right">
          <strong>DATE:</strong> ${new Date().toLocaleDateString('en-GB')}<br>
          <strong>REF:</strong> REC/STATUTORY/${l.accountNumber}<br>
          <strong>DAYS IN DEFAULT:</strong> <span style="color:#DC2626;font-weight:700">${l.daysPastDue} Days</span>
        </div>
      </div>

      <div style="font-size:13.5px;font-weight:800;color:#991B1B;margin-bottom:12px;text-transform:uppercase">
        FINAL NOTICE OF DEFAULT & 14-DAY STATUTORY DEMAND PRIOR TO ASSET REPOSSESSION
      </div>

      <p style="font-size:12px;margin-bottom:12px">
        TAKE NOTICE that you are in persistent default of your repayment obligations under the Logbook Loan Facility Agreement entered into with Spectrum Credit Limited in respect of vehicle registration <strong>${l.reg}</strong> (${l.vehicle}).
      </p>

      <table class="tbl" style="margin-bottom:16px;border:1px solid #CBD5E1">
        <tr><td style="font-weight:600;width:220px">Total Arrears in Default:</td><td style="font-weight:700;color:#DC2626">${FinEngine.kes(overdueAmt)}</td></tr>
        <tr><td style="font-weight:600">Accrued Default Penalty Fees:</td><td>${FinEngine.kes(l.unpaidPenalties || 2500)}</td></tr>
        <tr><td style="font-weight:600">Collateral Pledged:</td><td>Motor Vehicle Reg: <strong>${l.reg}</strong></td></tr>
        <tr><td style="font-weight:600">Statutory Cure Deadline:</td><td><strong>14 Calendar Days from Date of Notice</strong></td></tr>
      </table>

      <p style="font-size:12px;margin-bottom:12px">
        UNLESS the overdue arrears amount of <strong>${FinEngine.kes(overdueAmt)}</strong> is paid in full within fourteen (14) days, Spectrum Credit shall proceed without further reference to you to:
      </p>
      <ol style="font-size:11.5px;padding-left:18px;margin-bottom:20px">
        <li>Issue formal Warrant of Repossession to licensed court auctioneers.</li>
        <li>Immobilize and impound motor vehicle registration <strong>${l.reg}</strong> via active GPS telematics tracking.</li>
        <li>Liquidate the pledged asset via public auction pursuant to Section 90 of the Land Act and Chattels Transfer Act (Cap 28).</li>
      </ol>

      <div style="display:flex;justify-content:flex-end;gap:10px">
        <button class="btn" onclick="document.getElementById('offer-letter-modal').classList.remove('active')">Close</button>
        <button class="btn btn-danger" onclick="window.print()"><i class="ti ti-printer"></i> Print Statutory Demand Letter</button>
      </div>
    `;

    modal.classList.add('active');
  },

  printReceipt(accountNumber, receiptNo) {
    const data = DataStore.get();
    const l = (data.loans || []).find(x => x.accountNumber === accountNumber);
    const r = l?.repaymentsHistory?.find(x => x.receiptNo === receiptNo);
    if (!l || !r) return;

    const modal = document.getElementById('offer-letter-modal');
    const content = document.getElementById('offer-letter-content');
    if (!modal || !content) return;

    content.innerHTML = `
      <div style="text-align:center;border-bottom:2px solid #059669;padding-bottom:10px;margin-bottom:14px">
        <div style="font-size:18px;font-weight:800;color:#0F172A">SPECTRUM CREDIT LIMITED</div>
        <div style="font-size:11px;color:#059669;font-weight:700">OFFICIAL REPAYMENT CASHIER RECEIPT</div>
      </div>

      <div style="display:flex;justify-content:space-between;margin-bottom:14px;font-size:12px">
        <div>
          <strong>RECEIPT NO:</strong> ${r.receiptNo}<br>
          <strong>DATE:</strong> ${r.date}<br>
          <strong>CUSTOMER:</strong> ${l.customer}
        </div>
        <div style="text-align:right">
          <strong>LOAN ACCOUNT:</strong> ${l.accountNumber}<br>
          <strong>CHANNEL:</strong> ${r.channel}<br>
          <strong>REF CODE:</strong> ${r.reference}
        </div>
      </div>

      <table class="tbl" style="margin-bottom:14px;border:1px solid #CBD5E1">
        <tr style="background:#ECFDF5"><td style="font-weight:700">TOTAL SUM RECEIVED:</td><td style="font-weight:800;color:#059669;font-size:14px">${FinEngine.kes(r.amount)}</td></tr>
        <tr><td>Applied to Principal Reduction:</td><td>${FinEngine.kes(r.allocatedPrincipal)}</td></tr>
        <tr><td>Applied to Monthly Interest:</td><td>${FinEngine.kes(r.allocatedInterest)}</td></tr>
        <tr><td>Applied to Late Penalties / Fees:</td><td>${FinEngine.kes(r.allocatedPenalty)}</td></tr>
        <tr style="background:#F8FAFC"><td style="font-weight:600">Remaining Loan Balance:</td><td style="font-weight:700;color:#0F172A">${FinEngine.kes(l.currentPrincipal)}</td></tr>
      </table>

      <div style="font-size:10px;color:var(--text-tertiary);text-align:center">
        Spectrum Credit Limited · Automated Financial Servicing · System Generated Valid Receipt
      </div>

      <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:16px">
        <button class="btn" onclick="document.getElementById('offer-letter-modal').classList.remove('active')">Close</button>
        <button class="btn btn-primary" onclick="window.print()"><i class="ti ti-printer"></i> Print Receipt</button>
      </div>
    `;

    modal.classList.add('active');
  },

  // Interactive M-Pesa STK Push Simulator
  triggerSTKPush(accountNumber) {
    const data = DataStore.get();
    const l = (data.loans || []).find(x => x.accountNumber === accountNumber);
    if (!l) return;

    const amt = parseFloat(document.getElementById('pay-amount')?.value) || 35000;
    const phone = document.getElementById('pay-sender')?.value || l.phone;

    const modal = document.getElementById('offer-letter-modal');
    const content = document.getElementById('offer-letter-content');
    if (!modal || !content) return;

    let enteredPin = '';

    window._onSTKKey = (digit) => {
      if (digit === 'DEL') {
        enteredPin = enteredPin.slice(0, -1);
      } else if (enteredPin.length < 4) {
        enteredPin += digit;
      }

      for (let i = 0; i < 4; i++) {
        const dot = document.getElementById(`stk-dot-${i}`);
        if (dot) dot.className = `stk-pin-dot ${i < enteredPin.length ? 'filled' : ''}`;
      }

      if (enteredPin.length === 4) {
        document.getElementById('stk-status-text').innerHTML = '<span style="color:#00A859">✓ Transmitting Encrypted PIN to Safaricom...</span>';
        setTimeout(() => {
          document.getElementById('offer-letter-modal').classList.remove('active');
          document.getElementById('pay-channel').value = 'M-PESA (Paybill 400200)';
          document.getElementById('pay-ref').value = 'QA' + Math.floor(10000000 + Math.random() * 90000000);
          LMSModule.executePayment(accountNumber);
        }, 800);
      }
    };

    content.innerHTML = `
      <div class="stk-modal-box">
        <div class="stk-notch"></div>
        <div class="stk-mpesa-badge">M-PESA SIM TOOLKIT</div>
        <div style="font-size:14px;font-weight:700;margin-bottom:6px">Spectrum Credit Paybill 400200</div>
        <div style="font-size:12px;color:#9CA3AF;margin-bottom:12px">
          Do you want to pay <strong style="color:white">${FinEngine.kes(amt)}</strong> to Spectrum Credit Ltd for Account <strong>${l.accountNumber}</strong>?
        </div>
        <div style="font-size:11px;color:#00A859;font-weight:600" id="stk-status-text">Enter M-Pesa PIN</div>

        <div class="stk-pin-dots">
          <div class="stk-pin-dot" id="stk-dot-0"></div>
          <div class="stk-pin-dot" id="stk-dot-1"></div>
          <div class="stk-pin-dot" id="stk-dot-2"></div>
          <div class="stk-pin-dot" id="stk-dot-3"></div>
        </div>

        <div class="stk-keypad">
          ${[1,2,3,4,5,6,7,8,9].map(n => `<button class="stk-key" onclick="window._onSTKKey('${n}')">${n}</button>`).join('')}
          <button class="stk-key" onclick="window._onSTKKey('DEL')"><i class="ti ti-backspace"></i></button>
          <button class="stk-key" onclick="window._onSTKKey('0')">0</button>
          <button class="stk-key" style="background:#00A859;color:white" onclick="alert('Please enter 4 digits using the keypad')"><i class="ti ti-check"></i></button>
        </div>

        <div style="margin-top:14px;font-size:10px;color:#6B7280">
          Target Mobile: ${phone} · SSL 256-bit Secure
        </div>
      </div>
    `;

    modal.classList.add('active');
  },

  // Export Loan Amortization Statement to CSV
  exportLoanStatementCSV(accountNumber) {
    if (typeof App !== 'undefined' && App.canViewScheduleServicing && !App.canViewScheduleServicing()) {
      alert('Statements are available after disbursement for Overall Admin and Collection & Recovery.');
      return;
    }
    const data = DataStore.get();
    const l = (data.loans || []).find(x => x.accountNumber === accountNumber);
    if (!l) return;

    const headers = ['Period', 'Due Date', 'Installment (KES)', 'Principal (KES)', 'Interest (KES)', 'Balance (KES)', 'Status', 'Paid Date'];
    const rows = (l.schedule || []).map(r => [
      r.period,
      r.dueDate,
      r.installment,
      r.principal,
      r.interest,
      r.balance,
      r.status,
      r.paidDate || 'Unpaid'
    ]);

    let csvContent = 'data:text/csv;charset=utf-8,';
    csvContent += `SPECTRUM CREDIT LIMITED - LOAN STATEMENT\n`;
    csvContent += `Account Number: ${l.accountNumber}\n`;
    csvContent += `Customer: ${l.customer}\n`;
    csvContent += `Vehicle: ${l.vehicle} (${l.reg})\n\n`;
    csvContent += headers.join(',') + '\n';
    rows.forEach(row => {
      csvContent += row.join(',') + '\n';
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Statement_${l.accountNumber}_${l.reg.replace(/\s+/g, '_')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  },

  renderCollectionsActionPanel(l, data) {
    const role = data.activeRole;
    const isOfficer = role === 'COLLECTION_OFFICER';
    const isManager = role === 'COLLECTION_MANAGER' || role === 'OVERALL_ADMIN';
    const stage = ['None issued', 'Reminder issued', 'Statutory demand issued', 'Repossession authorized'][l.noticeStage || 0] || 'None issued';

    if (!isOfficer && !isManager) return '';

    return `
      <div class="card">
        <div class="card-header">
          <div class="card-title-group">
            <i class="ti ti-gavel" style="font-size:16px;color:#DC2626"></i>
            <span class="card-title">Collections & Recovery Desk (${data.roles[role]?.title})</span>
          </div>
          <span class="badge" style="background:#FEE2E2;color:#991B1B">${l.daysPastDue} DPD · ${stage}</span>
        </div>
        <div class="card-body">
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            ${isOfficer ? `
              <button class="btn btn-sm" onclick="LMSModule.logCollectionAction('${l.accountNumber}', 'Phone follow-up')">
                <i class="ti ti-phone"></i> Log Follow-up Call
              </button>
              <button class="btn btn-sm" onclick="LMSModule.logCollectionAction('${l.accountNumber}', 'Field visit')">
                <i class="ti ti-map-pin"></i> Log Field Visit
              </button>
              <button class="btn btn-sm btn-accent" onclick="LMSModule.issueReminderNotice('${l.accountNumber}')">
                <i class="ti ti-mail"></i> Issue 7-Day Reminder
              </button>
              ${l.daysPastDue > 14 ? `
                <button class="btn btn-sm btn-danger" onclick="LMSModule.escalateToCollectionsManager('${l.accountNumber}')">
                  <i class="ti ti-arrow-up"></i> Escalate to Manager
                </button>
              ` : ''}
            ` : ''}
            ${isManager ? `
              <button class="btn btn-sm btn-danger" onclick="LMSModule.showDemandNoticeModal('${l.accountNumber}')">
                <i class="ti ti-gavel"></i> 14-Day Statutory Demand
              </button>
              <button class="btn btn-sm" onclick="LMSModule.toggleImmobilizer('${l.accountNumber}')">
                <i class="ti ti-power"></i> GPS Immobilizer
              </button>
              ${l.status !== 'REPOSSESSED' ? `
                <button class="btn btn-sm btn-danger" onclick="LMSModule.authorizeRepossession('${l.accountNumber}')">
                  <i class="ti ti-truck"></i> Authorize Repossession
                </button>
              ` : '<span class="badge b-repossessed">Already repossessed</span>'}
            ` : ''}
          </div>
        </div>
      </div>
    `;
  },

  _stampCollection(l, data, action, note) {
    const today = new Date().toISOString().slice(0, 10);
    const nowTime = new Date().toTimeString().slice(0, 5);
    const by = data.roles[data.activeRole]?.title || data.activeRole;
    l.collectionsLog = l.collectionsLog || [];
    l.collectionsLog.push({ at: `${today} ${nowTime}`, by, action, note: note || '' });
    return `${today} ${nowTime}`;
  },

  logCollectionAction(accountNumber, action) {
    const note = prompt(`${action} note for ${accountNumber}:`, 'Borrower contacted. Promise to pay recorded.') || 'Action logged.';
    const data = DataStore.get();
    const l = (data.loans || []).find(x => x.accountNumber === accountNumber);
    if (!l) return;
    this._stampCollection(l, data, action, note);
    if (!l.assignedCollectionsRole) l.assignedCollectionsRole = 'COLLECTION_OFFICER';
    DataStore.save(data);
    if (App.currentTab === 'collections') App.renderCollectionsView();
    else this.openLoan360(accountNumber);
  },

  issueReminderNotice(accountNumber) {
    const data = DataStore.get();
    const l = (data.loans || []).find(x => x.accountNumber === accountNumber);
    if (!l) return;
    l.noticeStage = Math.max(l.noticeStage || 0, 1);
    this._stampCollection(l, data, '7-day reminder issued', `SMS/email reminder sent to ${l.phone} for ${FinEngine.kes((l.unpaidPenalties || 0) + (l.unpaidInterest || 0))} arrears.`);
    DataStore.save(data);
    alert(`7-day reminder issued to ${l.customer} (${l.phone}) on account ${accountNumber}.`);
    if (App.currentTab === 'collections') App.renderCollectionsView();
    else this.openLoan360(accountNumber);
  },

  escalateToCollectionsManager(accountNumber) {
    const data = DataStore.get();
    const l = (data.loans || []).find(x => x.accountNumber === accountNumber);
    if (!l) return;
    const ts = this._stampCollection(l, data, 'Escalated to manager', 'Officer requests statutory demand / legal recoveries review.');
    l.assignedCollectionsRole = 'COLLECTION_MANAGER';
    data.notifications = data.notifications || [];
    data.notifications.unshift({
      id: Date.now(),
      role: 'COLLECTION_MANAGER',
      message: `${accountNumber} (${l.customer}) escalated — ${l.daysPastDue} DPD. Statutory demand review required.`,
      appId: accountNumber,
      time: ts,
      read: false
    });
    DataStore.save(data);
    App.updateNotifications();
    alert(`Escalated ${accountNumber} to Collection & Recovery Manager.`);
    if (App.currentTab === 'collections') App.renderCollectionsView();
    else this.openLoan360(accountNumber);
  },

  authorizeRepossession(accountNumber) {
    const data = DataStore.get();
    const l = (data.loans || []).find(x => x.accountNumber === accountNumber);
    if (!l) return;
    if (!confirm(`Authorize repossession of ${l.reg} (${l.customer}) and activate GPS cutoff?`)) return;

    l.status = 'REPOSSESSED';
    l.noticeStage = 3;
    l.assignedCollectionsRole = 'COLLECTION_MANAGER';
    this._stampCollection(l, data, 'Repossession authorized', 'Warrant issued. GPS immobilizer engaged. Asset to be held pending auction.');

    const vault = (data.collateralVault || []).find(v => v.vaultId === l.collateralVaultId || v.regNumber === l.reg);
    if (vault) {
      vault.status = 'UNDER_REPOSSESSION';
      if (vault.gpsDetails) {
        vault.gpsDetails.immobilizerState = 'REMOTE_CUTOFF_ACTIVE';
        vault.gpsDetails.engineStatus = 'ENGINE_OFF_CUTOFF';
      }
    }

    const ts = new Date().toISOString().slice(0, 10) + ' ' + new Date().toTimeString().slice(0, 5);
    data.notifications = data.notifications || [];
    data.notifications.unshift({
      id: Date.now(),
      role: 'COLLECTION_MANAGER',
      message: `Repossession authorized for ${accountNumber} (${l.reg}). Legal recoveries file opened.`,
      appId: accountNumber,
      time: ts,
      read: false
    });

    DataStore.save(data);
    App.updateTopMetrics();
    App.updateNotifications();
    alert(`Repossession authorized for ${l.reg}. Immobilizer cutoff is now active.`);
    if (App.currentTab === 'collections') App.renderCollectionsView();
    else this.openLoan360(accountNumber);
  },

  // --------------------------------------------------------------------------
  // Collateral Release — 8-step automated logbook discharge
  // --------------------------------------------------------------------------
  _nowStamp() {
    const d = new Date();
    return `${d.toISOString().slice(0, 10)} ${d.toTimeString().slice(0, 5)}`;
  },

  _actorTitle() {
    const data = DataStore.get();
    return data.roles[data.activeRole]?.title || data.activeRole;
  },

  _pushNoti(data, role, message, appId, time) {
    data.notifications = data.notifications || [];
    data.notifications.unshift({
      id: Date.now() + Math.floor(Math.random() * 99),
      role,
      message,
      appId,
      time,
      read: false
    });
  },

  canReviewClosure(role) {
    return role === 'FINANCE_OFFICER' || role === 'FINANCE_MANAGER' || role === 'CREDIT_ADMIN' || role === 'OVERALL_ADMIN';
  },

  canOperateRelease(role) {
    return role === 'CREDIT_ADMIN' || role === 'BRANCH_ADMIN' || role === 'FINANCE_OFFICER' || role === 'FINANCE_MANAGER' || role === 'OVERALL_ADMIN';
  },

  renderPaidInFullBanner(l) {
    if (!FinEngine.isPaidInFull(l) && l.status !== 'PAID_IN_FULL' && l.status !== 'CLOSED' && !l.release) return '';
    const rel = l.release;
    const closed = l.status === 'CLOSED' || rel?.status === 'CLOSED_LOGBOOK_RELEASED';
    return `
      <div class="alert ${closed ? 'alert-success' : 'alert-info'}">
        <i class="ti ${closed ? 'ti-circle-check' : 'ti-lock-open'}"></i>
        <div>
          <strong>${closed ? 'CLOSED → LOGBOOK RELEASED' : 'Paid in Full — logbook release in progress.'}</strong>
          ${rel ? ` Current step: ${FinEngine.RELEASE_STEPS[(rel.stage || 1) - 1]?.label || rel.status.replace(/_/g, ' ')}.` : ''}
          <div style="margin-top:6px">
            <button class="btn btn-sm btn-success" onclick="LMSModule.openReleaseWorkflow('${l.accountNumber}')">
              <i class="ti ti-arrow-right"></i> Open collateral release workflow
            </button>
          </div>
        </div>
      </div>
    `;
  },

  initiateCollateralRelease(accountNumber, payment) {
    const data = DataStore.get();
    const l = (data.loans || []).find(x => x.accountNumber === accountNumber);
    if (!l) return;

    const ts = this._nowStamp();
    const lastPay = payment || (l.repaymentsHistory || [])[0] || {};
    const reconLoan = {
      ...l,
      currentPrincipal: l.currentPrincipal,
      unpaidInterest: l.unpaidInterest,
      unpaidPenalties: l.unpaidPenalties,
      repaymentsHistory: l.repaymentsHistory
    };

    if (!l.release || l.release.status === 'RECONCILIATION_FAILED') {
      l.release = FinEngine.createCollateralRelease(reconLoan, lastPay, ts);
    }

    if (l.release.status === 'RECONCILIATION_FAILED') {
      alert('Final repayment could not be reconciled (mismatch or reversed transaction).');
      this.openLoan360(accountNumber);
      return;
    }

    l.status = 'PAID_IN_FULL';
    l.daysPastDue = 0;
    l.parStatus = 'PAR_0';
    l.assignedCollectionsRole = null;
    l.nextDueDate = null;

    const vault = (data.collateralVault || []).find(v => v.vaultId === l.collateralVaultId || v.regNumber === l.reg);
    if (vault && vault.status === 'IN_CUSTODY') vault.status = 'PENDING_DISCHARGE';

    this._pushNoti(data, 'FINANCE_OFFICER', `Paid in Full: ${l.accountNumber} (${l.customer}) — confirm closure checklist for logbook release`, l.accountNumber, ts);
    this._pushNoti(data, 'FINANCE_MANAGER', `Closure review queue: ${l.accountNumber} final repayment matched outstanding balance`, l.accountNumber, ts);
    this._pushNoti(data, 'CREDIT_ADMIN', `Logbook release pending: ${l.reg} (${l.customer}) — vault PENDING_DISCHARGE after PIF`, l.accountNumber, ts);

    DataStore.save(data);
    App.updateTopMetrics();
    App.updateNotifications();
    alert(`Account ${l.accountNumber} is Paid in Full. Collateral release queued for Finance/Operations review.`);
    this.openReleaseWorkflow(accountNumber);
  },

  openReleaseFromVault(vaultId) {
    const data = DataStore.get();
    const v = (data.collateralVault || []).find(x => x.vaultId === vaultId);
    if (!v) return;
    const loan = (data.loans || []).find(l => l.collateralVaultId === vaultId || l.reg === v.regNumber);
    if (!loan) {
      alert('No loan account is linked to this vault item.');
      return;
    }
    if (!FinEngine.isPaidInFull(loan) && loan.status !== 'PAID_IN_FULL' && loan.status !== 'COMPLETED' && loan.status !== 'CLOSED') {
      alert(`Logbook ${v.regNumber} can only be released after the loan is paid in full.`);
      LMSModule.openLoan360(loan.accountNumber);
      return;
    }
    if (!loan.release) {
      this.initiateCollateralRelease(loan.accountNumber, (loan.repaymentsHistory || [])[0]);
      return;
    }
    this.openReleaseWorkflow(loan.accountNumber);
  },

  releaseLogbookDualCustody(vaultId) {
    this.openReleaseFromVault(vaultId);
  },

  openReleaseWorkflow(accountNumber) {
    const data = DataStore.get();
    const l = (data.loans || []).find(x => x.accountNumber === accountNumber);
    if (!l) return;

    if (!l.release && FinEngine.isPaidInFull(l)) {
      this.initiateCollateralRelease(accountNumber, (l.repaymentsHistory || [])[0]);
      return;
    }
    if (!l.release) {
      alert('Collateral release starts automatically when the final repayment is reconciled.');
      this.openLoan360(accountNumber);
      return;
    }

    data.selectedLoanId = accountNumber;
    DataStore.save(data);

    const rel = l.release;
    const vault = (data.collateralVault || []).find(v => v.vaultId === l.collateralVaultId || v.regNumber === l.reg);
    const container = document.getElementById('release-detail-content');
    if (!container) return;

    const stepClass = (n) => {
      if (n < rel.stage) return 'done';
      if (n === rel.stage) return 'active';
      return 'pending';
    };

    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:1rem;flex-wrap:wrap">
        <div>
          <button class="btn btn-sm" onclick="App.showTab('collateral')" style="margin-bottom:6px">
            <i class="ti ti-arrow-left"></i> Back to Collateral Vault
          </button>
          <div style="font-size:18px;font-weight:700;color:var(--brand-primary)">Collateral Release — ${l.customer}</div>
          <div style="font-size:12px;color:var(--text-secondary)">
            Account <span class="app-num">${l.accountNumber}</span> · ${l.vehicle} (${l.reg}) · Vault ${vault?.vaultId || l.collateralVaultId || '—'}
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <span class="badge ${rel.status === 'CLOSED_LOGBOOK_RELEASED' ? 'b-logbook_released' : rel.status === 'PAID_IN_FULL' || rel.status === 'PENDING_CLOSURE_REVIEW' ? 'b-paid_in_full' : 'b-approved_for_release'}">${rel.status.replace(/_/g, ' ').toLowerCase()}</span>
          <button class="btn btn-sm" onclick="LMSModule.openLoan360('${l.accountNumber}')"><i class="ti ti-chart-bar"></i> Account 360</button>
        </div>
      </div>

      <div class="stage-flow-track release-flow">
        ${FinEngine.RELEASE_STEPS.map(s => `
          <div class="stage-step ${stepClass(s.n)}" onclick="LMSModule.scrollReleaseStep(${s.n})">${s.n}. ${s.short}</div>
        `).join('')}
      </div>

      ${this.renderReleaseStepPanel(l, rel, vault, data)}
    `;

    App.showTab('release-detail', { skipDetail: true });
  },

  scrollReleaseStep(n) {
    document.getElementById(`release-step-${n}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  renderReleaseStepPanel(l, rel, vault, data) {
    const role = data.activeRole;
    const canReview = this.canReviewClosure(role);
    const canOps = this.canOperateRelease(role);
    const c = rel.checklist || {};
    const d = rel.documents || {};
    const t = rel.teamNotified || {};
    const n = rel.customerNotice || {};
    const a = rel.appointment || {};
    const h = rel.handover || {};
    const lastPay = (l.repaymentsHistory || [])[0] || {};
    const recon = rel.reconciliation || {};

    const logHtml = (rel.log || []).length ? `
      <div class="card">
        <div class="card-header"><span class="card-title">Release audit trail</span></div>
        <div class="card-body" style="padding-top:0.5rem">
          ${[...rel.log].reverse().map(e => `
            <div class="detail-row" style="padding:8px 0;align-items:flex-start">
              <div>
                <div style="font-weight:600;font-size:12px">${e.action}</div>
                <div style="font-size:11px;color:var(--text-secondary)">${e.note || ''} · By: ${e.by}</div>
              </div>
              <div style="font-family:var(--font-mono);font-size:11px;color:var(--text-tertiary);white-space:nowrap">${e.at}</div>
            </div>
          `).join('')}
        </div>
      </div>
    ` : '';

    return `
      <div class="card" id="release-step-1">
        <div class="card-header">
          <div class="card-title-group">
            <i class="ti ti-circle-check" style="color:#059669;font-size:18px"></i>
            <span class="card-title">Step 1 — Auto Payment Reconciliation</span>
          </div>
          <span class="badge b-paid_in_full">Paid in Full</span>
        </div>
        <div class="card-body">
          <div class="alert alert-success" style="margin-bottom:12px">
            <i class="ti ti-checks"></i>
            <span>System verified final repayment via ${recon.channel || lastPay.channel || 'M-Pesa / bank'}, amount matched outstanding balance, and no reversed transactions were found. Account marked <strong>Paid in Full</strong>.</span>
          </div>
          <div class="form-grid">
            <div class="detail-row"><span class="detail-label">Final receipt</span><span class="detail-val app-num">${recon.receiptNo || lastPay.receiptNo || '—'}</span></div>
            <div class="detail-row"><span class="detail-label">Channel</span><span class="detail-val">${recon.channel || lastPay.channel || '—'}</span></div>
            <div class="detail-row"><span class="detail-label">Amount received</span><span class="detail-val">${FinEngine.kes(recon.amount || lastPay.amount || 0)}</span></div>
            <div class="detail-row"><span class="detail-label">Outstanding after posting</span><span class="detail-val" style="color:#059669">${FinEngine.kes(FinEngine.outstandingServicingBalance(l))}</span></div>
            <div class="detail-row"><span class="detail-label">Reversed transactions</span><span class="detail-val">${recon.reversedTransactions ? 'Yes — blocked' : 'None'}</span></div>
            <div class="detail-row"><span class="detail-label">Reconciled at</span><span class="detail-val">${recon.verifiedAt || '—'}</span></div>
          </div>
        </div>
      </div>

      <div class="card" id="release-step-2">
        <div class="card-header">
          <div class="card-title-group">
            <i class="ti ti-clipboard-check" style="color:#0284C7;font-size:18px"></i>
            <span class="card-title">Step 2 — Loan Closure Verification Queue</span>
          </div>
          <span class="badge ${rel.status === 'APPROVED_FOR_RELEASE' || rel.stage > 2 ? 'b-approved_for_release' : 'b-pending_closure_review'}">${rel.stage > 2 ? 'Approved for Release' : 'Pending Closure Review'}</span>
        </div>
        <div class="card-body">
          <p class="hint" style="margin-top:0">Finance / Operations confirm all payments cleared, no chargebacks, no duplicate balances, and customer identity before automatic release continues.</p>
          <div class="release-check-list">
            <label class="release-check"><input type="checkbox" id="rel-chk-pay" ${c.paymentsCleared ? 'checked' : ''} ${rel.stage > 2 || !canReview ? 'disabled' : ''}> Confirm all payments cleared</label>
            <label class="release-check"><input type="checkbox" id="rel-chk-cb" ${c.noChargebacks ? 'checked' : ''} ${rel.stage > 2 || !canReview ? 'disabled' : ''}> Confirm no chargebacks</label>
            <label class="release-check"><input type="checkbox" id="rel-chk-dup" ${c.noDuplicateBalances ? 'checked' : ''} ${rel.stage > 2 || !canReview ? 'disabled' : ''}> Confirm no duplicate balances</label>
            <label class="release-check"><input type="checkbox" id="rel-chk-id" ${c.identityVerified ? 'checked' : ''} ${rel.stage > 2 || !canReview ? 'disabled' : ''}> Verify customer identity request (ID ${l.idNumber || '—'})</label>
          </div>
          ${rel.stage > 2 ? `<div class="hint">Approved by ${c.reviewedBy} on ${c.reviewedAt}.</div>` : ''}
          ${rel.stage === 2 && canReview ? `
            <button class="btn btn-success" onclick="LMSModule.approveClosureReview('${l.accountNumber}')">
              <i class="ti ti-check"></i> Approve for Release
            </button>
          ` : ''}
        </div>
      </div>

      <div class="card" id="release-step-3">
        <div class="card-header">
          <div class="card-title-group">
            <i class="ti ti-files" style="color:#7C3AED;font-size:18px"></i>
            <span class="card-title">Step 3 — Auto Generate Clearance Documents</span>
          </div>
          ${d.generatedAt ? '<span class="badge b-completed">Generated</span>' : ''}
        </div>
        <div class="card-body">
          ${rel.stage < 3 ? '<p class="hint" style="margin-top:0">Available after closure is approved.</p>' : `
            <p class="hint" style="margin-top:0">Loan Clearance Certificate, Final Statement, Logbook Release Letter, and Account Closure Confirmation — email / SMS to the client.</p>
            ${!d.generatedAt && canOps ? `
              <button class="btn btn-primary" onclick="LMSModule.generateClearanceDocuments('${l.accountNumber}')">
                <i class="ti ti-sparkles"></i> Generate clearance pack
              </button>
            ` : ''}
            ${d.generatedAt ? `
              <div class="alert alert-success" style="margin-bottom:10px">
                <i class="ti ti-sparkles"></i>
                <span>Clearance pack auto-generated after closure approval. Email / SMS share with the client, or print each document.</span>
              </div>
            ` : ''}
            ${d.generatedAt ? `
              <div style="display:flex;flex-wrap:wrap;gap:8px">
                <button class="btn btn-sm" onclick="LMSModule.printReleaseDocument('${l.accountNumber}', 'clearance')"><i class="ti ti-certificate"></i> Clearance Certificate</button>
                <button class="btn btn-sm" onclick="LMSModule.printReleaseDocument('${l.accountNumber}', 'statement')"><i class="ti ti-file-analytics"></i> Final Statement</button>
                <button class="btn btn-sm" onclick="LMSModule.printReleaseDocument('${l.accountNumber}', 'letter')"><i class="ti ti-mail"></i> Logbook Release Letter</button>
                <button class="btn btn-sm" onclick="LMSModule.printReleaseDocument('${l.accountNumber}', 'closure')"><i class="ti ti-file-check"></i> Account Closure Confirmation</button>
                <button class="btn btn-sm btn-accent" onclick="LMSModule.shareClearanceDocuments('${l.accountNumber}')"><i class="ti ti-send"></i> Email / SMS pack</button>
              </div>
              <div class="hint" style="margin-top:8px">Generated ${d.generatedAt}. Pack can be emailed to ${l.email || 'the registered email'} or SMS-shared with ${l.phone}.</div>
            ` : ''}
          `}
        </div>
      </div>

      <div class="card" id="release-step-4">
        <div class="card-header">
          <div class="card-title-group">
            <i class="ti ti-bell" style="color:#D97706;font-size:18px"></i>
            <span class="card-title">Step 4 — Notify Internal Teams</span>
          </div>
          ${t.at ? '<span class="badge b-completed">Notified</span>' : ''}
        </div>
        <div class="card-body">
          ${rel.stage < 4 ? '<p class="hint" style="margin-top:0">Runs after documents are generated.</p>' : `
            <div class="release-team-grid">
              <div class="release-team ${t.operations ? 'is-done' : ''}"><i class="ti ti-building"></i> Operations team</div>
              <div class="release-team ${t.custody ? 'is-done' : ''}"><i class="ti ti-building-warehouse"></i> Custody / document team</div>
              <div class="release-team ${t.branchManager ? 'is-done' : ''}"><i class="ti ti-user-star"></i> Branch manager</div>
              <div class="release-team ${t.collections ? 'is-done' : ''}"><i class="ti ti-phone-off"></i> Collections (stop follow-ups)</div>
            </div>
            ${!t.at && canOps ? `
              <button class="btn btn-primary" style="margin-top:10px" onclick="LMSModule.notifyInternalTeams('${l.accountNumber}')">
                <i class="ti ti-bell-ringing"></i> Notify operations, custody, branch &amp; collections
              </button>
            ` : t.at ? `<div class="hint" style="margin-top:8px">Sent ${t.at}. Collections follow-ups are stopped on this account.</div>` : ''}
          `}
        </div>
      </div>

      <div class="card" id="release-step-5">
        <div class="card-header">
          <div class="card-title-group">
            <i class="ti ti-device-mobile" style="color:#059669;font-size:18px"></i>
            <span class="card-title">Step 5 — Customer Notification</span>
          </div>
          ${n.sent ? '<span class="badge b-completed">SMS / email sent</span>' : ''}
        </div>
        <div class="card-body">
          ${rel.stage < 5 ? '<p class="hint" style="margin-top:0">Customer is notified after internal teams.</p>' : `
            <div class="sms-preview">
              <div class="sms-preview-label">SMS to ${l.phone}</div>
              <div class="sms-preview-body">${FinEngine.CUSTOMER_RELEASE_SMS}</div>
            </div>
            ${!n.sent && canOps ? `
              <button class="btn btn-success" style="margin-top:10px" onclick="LMSModule.notifyCustomerRelease('${l.accountNumber}')">
                <i class="ti ti-send"></i> Send SMS / email to client
              </button>
            ` : n.sent ? `<div class="hint" style="margin-top:8px">Sent via ${n.channel} on ${n.at}.</div>` : ''}
          `}
        </div>
      </div>

      <div class="card" id="release-step-6">
        <div class="card-header">
          <div class="card-title-group">
            <i class="ti ti-calendar-event" style="color:#0284C7;font-size:18px"></i>
            <span class="card-title">Step 6 — Logbook Release Appointment</span>
          </div>
          ${a.bookedAt ? '<span class="badge b-completed">Booked</span>' : ''}
        </div>
        <div class="card-body">
          ${rel.stage < 6 ? '<p class="hint" style="margin-top:0">Customer books branch pickup (or courier delivery — optional future feature).</p>' : `
            ${a.bookedAt ? `
              <div class="detail-row"><span class="detail-label">Method</span><span class="detail-val">${a.method === 'COURIER' ? 'Courier delivery (requested)' : 'Branch pickup'}</span></div>
              <div class="detail-row"><span class="detail-label">Branch</span><span class="detail-val">${a.branch || '—'}</span></div>
              <div class="detail-row"><span class="detail-label">When</span><span class="detail-val">${a.date || '—'} ${a.time || ''}</span></div>
            ` : `
              <div class="form-grid">
                <div class="fg">
                  <label>Collection method</label>
                  <select id="rel-appt-method">
                    <option value="BRANCH_PICKUP">Branch pickup</option>
                    <option value="COURIER">Courier delivery (optional future feature)</option>
                  </select>
                </div>
                <div class="fg">
                  <label>Branch</label>
                  <select id="rel-appt-branch">
                    <option>Nairobi CBD Branch</option>
                    <option>Westlands Branch</option>
                    <option>Mombasa Branch</option>
                    <option>Kisumu Branch</option>
                    <option>Nakuru Branch</option>
                  </select>
                </div>
                <div class="fg"><label>Date</label><input type="date" id="rel-appt-date" value="${FinEngine.toISODate(FinEngine.addDays(new Date(), 2))}"></div>
                <div class="fg"><label>Time</label><input type="time" id="rel-appt-time" value="10:00"></div>
              </div>
              ${canOps ? `
                <button class="btn btn-primary" style="margin-top:10px" onclick="LMSModule.bookReleaseAppointment('${l.accountNumber}')">
                  <i class="ti ti-calendar-plus"></i> Book appointment
                </button>
              ` : ''}
            `}
          `}
        </div>
      </div>

      <div class="card" id="release-step-7">
        <div class="card-header">
          <div class="card-title-group">
            <i class="ti ti-id" style="color:#0F766E;font-size:18px"></i>
            <span class="card-title">Step 7 — Physical Document Handover</span>
          </div>
          ${h.releasedAt ? '<span class="badge b-completed">Handover complete</span>' : ''}
        </div>
        <div class="card-body">
          ${rel.stage < 7 ? '<p class="hint" style="margin-top:0">Staff verify National ID, signed release forms, and customer acknowledgement.</p>' : `
            ${h.releasedAt ? `
              <div class="detail-row"><span class="detail-label">National ID</span><span class="detail-val">${h.idNumberPresented}</span></div>
              <div class="detail-row"><span class="detail-label">Receiving customer</span><span class="detail-val">${h.receivingCustomer}</span></div>
              <div class="detail-row"><span class="detail-label">Staff handling release</span><span class="detail-val">${h.staffName}</span></div>
              <div class="detail-row"><span class="detail-label">Acknowledgement</span><span class="detail-val app-num">${h.acknowledgementRef}</span></div>
            ` : `
              <div class="form-grid">
                <div class="fg"><label>National ID presented</label><input id="rel-id-no" value="${h.idNumberPresented || l.idNumber || ''}"></div>
                <div class="fg"><label>Receiving customer</label><input id="rel-recv"" value="${h.receivingCustomer || l.customer}"></div>
                <div class="fg"><label>Staff handling release</label><input id="rel-staff"" placeholder="${this._actorTitle()}"></div>
                <div class="fg"><label>Acknowledgement ref (optional)</label><input id="rel-ack" placeholder="Auto-issued on complete"></div>
              </div>
              <div class="release-check-list" style="margin-top:10px">
                <label class="release-check"><input type="checkbox" id="rel-id-ok"> National ID verified</label>
                <label class="release-check"><input type="checkbox" id="rel-form"-ok"> Release forms signed</label>
                <label class="release-check"><input type="checkbox" id="rel-ack-ok"> Customer acknowledgement receipt signed</label>
              </div>
              ${canOps ? `
                <button class="btn btn-accent" onclick="LMSModule.completeHandover('${l.accountNumber}')">
                  <i class="ti ti-signature"></i> Complete physical handover
                </button>
              ` : ''}
            `}
          `}
        </div>
      </div>

      <div class="card" id="release-step-8">
        <div class="card-header">
          <div class="card-title-group">
            <i class="ti ti-lock-open" style="color:#059669;font-size:18px"></i>
            <span class="card-title">Step 8 — Update System Status</span>
          </div>
          ${rel.status === 'CLOSED_LOGBOOK_RELEASED' ? '<span class="badge b-logbook_released">CLOSED → LOGBOOK RELEASED</span>' : ''}
        </div>
        <div class="card-body">
          ${rel.status === 'CLOSED_LOGBOOK_RELEASED' ? `
            <div class="alert alert-success">
              <i class="ti ti-circle-check"></i>
              <div>
                Final status <strong>CLOSED → LOGBOOK RELEASED</strong>.
                Release date ${h.releasedAt}. Receiving customer ${h.receivingCustomer}. Staff ${h.staffName}. Acknowledgement ${h.acknowledgementRef}.
              </div>
            </div>
            <button class="btn btn-sm btn-primary" onclick="LMSModule.printReleaseDocument('${l.accountNumber}', 'letter')"><i class="ti ti-printer"></i> Print release letter</button>
          ` : rel.stage >= 8 ? `
            <p class="hint" style="margin-top:0">Stores release date, receiving customer, staff handling release, and the signed acknowledgement form.</p>
            ${canOps ? `
              <button class="btn btn-success btn-lg" onclick="LMSModule.closeAndReleaseLogbook('${l.accountNumber}')">
                <i class="ti ti-lock-open"></i> Close account &amp; mark LOGBOOK RELEASED
              </button>
            ` : ''}
          ` : '<p class="hint" style="margin-top:0">Final status updates after physical handover.</p>'}
        </div>
      </div>

      ${logHtml}
    `;
  },

  _applyRelease(accountNumber, action, payload) {
    const data = DataStore.get();
    const l = (data.loans || []).find(x => x.accountNumber === accountNumber);
    if (!l?.release) return;
    const result = FinEngine.applyReleaseAction(l.release, action, payload, this._actorTitle(), this._nowStamp());
    if (!result.ok) {
      alert(result.error);
      return;
    }
    l.release = result.release;
    return { data, l };
  },

  approveClosureReview(accountNumber) {
    const checklist = {
      paymentsCleared: !!document.getElementById('rel-chk-pay')?.checked,
      noChargebacks: !!document.getElementById('rel-chk-cb')?.checked,
      noDuplicateBalances: !!document.getElementById('rel-chk-dup')?.checked,
      identityVerified: !!document.getElementById('rel-chk-id')?.checked
    };
    const applied = this._applyRelease(accountNumber, 'approve_checklist', { checklist });
    if (!applied) return;
    const vault = (applied.data.collateralVault || []).find(v => v.vaultId === applied.l.collateralVaultId || v.regNumber === applied.l.reg);
    if (vault) vault.status = 'PENDING_DISCHARGE';
    DataStore.save(applied.data);
    this._autoRunPostApproval(accountNumber);
    this.openReleaseWorkflow(accountNumber);
  },

  _autoRunPostApproval(accountNumber) {
    const docs = this._applyRelease(accountNumber, 'generate_documents');
    if (!docs) return;
    DataStore.save(docs.data);

    const teams = this._applyRelease(accountNumber, 'notify_teams');
    if (teams) {
      const ts = this._nowStamp();
      const l = teams.l;
      this._pushNoti(teams.data, 'CREDIT_ADMIN', `Operations: prepare logbook ${l.reg} for release — ${l.accountNumber} paid in full`, l.accountNumber, ts);
      this._pushNoti(teams.data, 'CREDIT_ADMIN', `Custody/document team: retrieve original logbook ${l.reg} from ${l.collateralVaultId}`, l.accountNumber, ts);
      this._pushNoti(teams.data, 'BRANCH_ADMIN', `Branch manager: ${l.customer} will collect logbook ${l.reg}. Book handover desk.`, l.accountNumber, ts);
      this._pushNoti(teams.data, 'COLLECTION_OFFICER', `Stop follow-ups: ${l.accountNumber} (${l.customer}) is paid in full — logbook release in progress`, l.accountNumber, ts);
      this._pushNoti(teams.data, 'COLLECTION_MANAGER', `Stop recoveries: ${l.accountNumber} (${l.reg}) paid in full. Remove from collections book.`, l.accountNumber, ts);
      l.assignedCollectionsRole = null;
      DataStore.save(teams.data);
    }

    const notice = this._applyRelease(accountNumber, 'notify_customer', {
      channel: 'SMS',
      message: FinEngine.CUSTOMER_RELEASE_SMS
    });
    if (notice) DataStore.save(notice.data);
    App.updateNotifications();
  },

  generateClearanceDocuments(accountNumber) {
    const applied = this._applyRelease(accountNumber, 'generate_documents');
    if (!applied) return;
    DataStore.save(applied.data);
    this.openReleaseWorkflow(accountNumber);
    this.printReleaseDocument(accountNumber, 'clearance');
  },

  shareClearanceDocuments(accountNumber) {
    const data = DataStore.get();
    const l = (data.loans || []).find(x => x.accountNumber === accountNumber);
    if (!l) return;
    alert(`Clearance pack emailed to ${l.email || l.customer} and SMS link shared with ${l.phone}.`);
  },

  notifyInternalTeams(accountNumber) {
    const applied = this._applyRelease(accountNumber, 'notify_teams');
    if (!applied) return;
    const ts = this._nowStamp();
    const l = applied.l;
    this._pushNoti(applied.data, 'CREDIT_ADMIN', `Operations: prepare logbook ${l.reg} for release — ${l.accountNumber} paid in full`, l.accountNumber, ts);
    this._pushNoti(applied.data, 'CREDIT_ADMIN', `Custody/document team: retrieve original logbook ${l.reg} from ${l.collateralVaultId}`, l.accountNumber, ts);
    this._pushNoti(applied.data, 'BRANCH_ADMIN', `Branch manager: ${l.customer} will collect logbook ${l.reg}. Book handover desk.`, l.accountNumber, ts);
    this._pushNoti(applied.data, 'COLLECTION_OFFICER', `Stop follow-ups: ${l.accountNumber} (${l.customer}) is paid in full — logbook release in progress`, l.accountNumber, ts);
    this._pushNoti(applied.data, 'COLLECTION_MANAGER', `Stop recoveries: ${l.accountNumber} (${l.reg}) paid in full. Remove from collections book.`, l.accountNumber, ts);
    l.assignedCollectionsRole = null;
    DataStore.save(applied.data);
    App.updateNotifications();
    this.openReleaseWorkflow(accountNumber);
  },

  notifyCustomerRelease(accountNumber) {
    const applied = this._applyRelease(accountNumber, 'notify_customer', {
      channel: 'SMS',
      message: FinEngine.CUSTOMER_RELEASE_SMS
    });
    if (!applied) return;
    DataStore.save(applied.data);
    alert(`SMS sent to ${applied.l.phone}:\n\n${FinEngine.CUSTOMER_RELEASE_SMS}`);
    this.openReleaseWorkflow(accountNumber);
  },

  bookReleaseAppointment(accountNumber) {
    const applied = this._applyRelease(accountNumber, 'book_appointment', {
      method: document.getElementById('rel-appt-method')?.value || 'BRANCH_PICKUP',
      branch: document.getElementById('rel-appt-branch')?.value || 'Nairobi CBD Branch',
      date: document.getElementById('rel-appt-date')?.value || '',
      time: document.getElementById('rel-appt-time')?.value || '10:00'
    });
    if (!applied) return;
    DataStore.save(applied.data);
    this.openReleaseWorkflow(accountNumber);
  },

  completeHandover(accountNumber) {
    const applied = this._applyRelease(accountNumber, 'complete_handover', {
      idVerified: !!document.getElementById('rel-id-ok')?.checked,
      idNumberPresented: document.getElementById('rel-id-no')?.value || '',
      releaseFormSigned: !!document.getElementById('rel-form-ok')?.checked,
      acknowledgementSigned: !!document.getElementById('rel-ack-ok')?.checked,
      receivingCustomer: document.getElementById('rel-recv')?.value || '',
      staffName: document.getElementById('rel-staff')?.value || this._actorTitle(),
      acknowledgementRef: document.getElementById('rel-ack')?.value || ''
    });
    if (!applied) return;
    DataStore.save(applied.data);
    this.openReleaseWorkflow(accountNumber);
  },

  closeAndReleaseLogbook(accountNumber) {
    const applied = this._applyRelease(accountNumber, 'close_and_release');
    if (!applied) return;
    const l = applied.l;
    l.status = 'CLOSED';
    l.daysPastDue = 0;
    l.parStatus = 'PAR_0';
    l.assignedCollectionsRole = null;
    const vault = (applied.data.collateralVault || []).find(v => v.vaultId === l.collateralVaultId || v.regNumber === l.reg);
    if (vault) {
      vault.status = 'RELEASED';
      vault.releasedAt = l.release.handover.releasedAt;
      vault.releasedTo = l.release.handover.receivingCustomer;
      vault.releasedBy = l.release.handover.staffName;
      vault.acknowledgementRef = l.release.handover.acknowledgementRef;
      if (vault.gpsDetails) {
        vault.gpsDetails.immobilizerState = 'DISENGAGED';
        vault.gpsDetails.engineStatus = 'ENGINE_OFF';
      }
    }
    const ts = this._nowStamp();
    this._pushNoti(applied.data, 'CREDIT_ADMIN', `CLOSED → LOGBOOK RELEASED: ${l.reg} handed to ${l.release.handover.receivingCustomer} (${l.accountNumber})`, l.accountNumber, ts);
    this._pushNoti(applied.data, 'BRANCH_ADMIN', `Logbook ${l.reg} released. Acknowledgement ${l.release.handover.acknowledgementRef}.`, l.accountNumber, ts);
    DataStore.save(applied.data);
    App.updateTopMetrics();
    App.updateNotifications();
    this.openReleaseWorkflow(accountNumber);
    this.printReleaseDocument(accountNumber, 'letter');
  },

  printReleaseDocument(accountNumber, kind) {
    const data = DataStore.get();
    const l = (data.loans || []).find(x => x.accountNumber === accountNumber);
    if (!l) return;
    const vault = (data.collateralVault || []).find(v => v.vaultId === l.collateralVaultId || v.regNumber === l.reg);
    const rel = l.release || {};
    const h = rel.handover || {};
    const recon = rel.reconciliation || {};
    const modal = document.getElementById('offer-letter-modal');
    const content = document.getElementById('offer-letter-content');
    if (!modal || !content) return;

    const letterhead = (subtitle, color = '#059669') => `
      <div style="text-align:center;border-bottom:2px solid ${color};padding-bottom:12px;margin-bottom:16px">
        <div style="font-size:20px;font-weight:800;color:#0F172A">SPECTRUM CREDIT LIMITED</div>
        <div style="font-size:12px;color:${color};font-weight:700">${subtitle}</div>
        <div style="font-size:11px;color:#475569">P.O Box 48921-00100 Nairobi · Tel: +254 20 765 4329</div>
      </div>
    `;
    const meta = `
      <div style="display:flex;justify-content:space-between;margin-bottom:14px;font-size:12px">
        <div>
          <strong>CUSTOMER:</strong> ${l.customer}<br>
          <strong>ID NO:</strong> ${l.idNumber || '—'}<br>
          <strong>CELL:</strong> ${l.phone}
        </div>
        <div style="text-align:right">
          <strong>ACCOUNT:</strong> ${l.accountNumber}<br>
          <strong>SECURITY:</strong> ${l.vehicle} (${l.reg})<br>
          <strong>DATE:</strong> ${new Date().toLocaleDateString('en-GB')}
        </div>
      </div>
    `;
    const signs = `
      <div style="display:flex;justify-content:space-between;margin-top:28px;padding-top:16px;border-top:1px solid #E2E8F0">
        <div>
          <div style="border-bottom:1px solid #000;width:180px;height:24px"></div>
          <div style="font-size:11px;font-weight:600">Head of Credit Administration</div>
        </div>
        <div>
          <div style="border-bottom:1px solid #000;width:180px;height:24px"></div>
          <div style="font-size:11px;font-weight:600">Safe Vault Custodian Officer</div>
        </div>
      </div>
    `;
    const actions = `
      <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:20px" class="no-print">
        <button class="btn" onclick="document.getElementById('offer-letter-modal').classList.remove('active')">Close</button>
        <button class="btn btn-primary" onclick="window.print()"><i class="ti ti-printer"></i> Print</button>
      </div>
    `;

    let body = '';
    if (kind === 'clearance') {
      body = `
        ${letterhead('LOAN CLEARANCE CERTIFICATE')}
        ${meta}
        <p style="font-size:12.5px">This certifies that the logbook loan facility on account <strong>${l.accountNumber}</strong> has been <strong>fully repaid</strong>. Spectrum Credit Limited confirms there is no outstanding principal, interest, tracking fee, penalty or other obligation on this account.</p>
        <table class="tbl" style="margin:14px 0;border:1px solid #CBD5E1">
          <tr><td style="font-weight:600;width:240px">Original facility</td><td>${FinEngine.kes(l.disbursedAmount)}</td></tr>
          <tr><td style="font-weight:600">Total repaid</td><td>${FinEngine.kes(l.totalPaid || 0)}</td></tr>
          <tr><td style="font-weight:600">Outstanding balance</td><td style="color:#059669;font-weight:700">${FinEngine.kes(0)}</td></tr>
          <tr><td style="font-weight:600">Final receipt</td><td>${recon.receiptNo || '—'}</td></tr>
          <tr><td style="font-weight:600">Account status</td><td><span class="badge b-paid_in_full">Paid in Full</span></td></tr>
        </table>
        ${signs}${actions}
      `;
    } else if (kind === 'statement') {
      const rows = (l.repaymentsHistory || []).map(r => `
        <tr>
          <td>${r.date}</td>
          <td>${r.receiptNo}</td>
          <td>${r.channel}</td>
          <td style="text-align:right">${FinEngine.kes(r.amount)}</td>
        </tr>
      `).join('');
      body = `
        ${letterhead('FINAL LOAN STATEMENT')}
        ${meta}
        <p style="font-size:12.5px">Final statement of account. All installments, interest, fees and penalties have been settled.</p>
        <table class="tbl" style="margin:14px 0;border:1px solid #CBD5E1">
          <thead><tr><th>Date</th><th>Receipt</th><th>Channel</th><th style="text-align:right">Amount</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="4">No receipts on file.</td></tr>'}</tbody>
        </table>
        <div class="ledger-line total"><span>Closing balance</span><strong>${FinEngine.kes(0)}</strong></div>
        ${signs}${actions}
      `;
    } else if (kind === 'closure') {
      body = `
        ${letterhead('ACCOUNT CLOSURE CONFIRMATION', '#0F172A')}
        ${meta}
        <p style="font-size:12.5px">This confirms that loan account <strong>${l.accountNumber}</strong> is closed. No further collections, interest, or charges will accrue. The original logbook is authorised for release from safe custody.</p>
        <table class="tbl" style="margin:14px 0;border:1px solid #CBD5E1">
          <tr><td style="font-weight:600;width:240px">Closure status</td><td>${l.status === 'CLOSED' ? 'CLOSED → LOGBOOK RELEASED' : 'PAID IN FULL — release in progress'}</td></tr>
          <tr><td style="font-weight:600">Vault</td><td>${vault?.vaultId || l.collateralVaultId || '—'}</td></tr>
          <tr><td style="font-weight:600">NTSA caveat</td><td>${vault?.ntsaCaveatRef || '—'}</td></tr>
        </table>
        ${signs}${actions}
      `;
    } else {
      body = `
        ${letterhead('LOGBOOK RELEASE LETTER & CAVEAT WITHDRAWAL')}
        <p style="font-size:12px;margin-bottom:14px">
          TO: <strong>NATIONAL TRANSPORT AND SAFETY AUTHORITY (NTSA)</strong><br>
          RE: <strong>WITHDRAWAL OF JOINT REGISTRATION / FINANCIAL INTEREST CAVEAT</strong>
        </p>
        ${meta}
        <p style="font-size:12.5px">The loan facility secured by motor vehicle registration <strong>${l.reg}</strong> has been repaid in full. Spectrum Credit Limited hereby withdraws all financial interest and instructs NTSA to remove the joint caveat. The original logbook is released to the registered owner.</p>
        <table class="tbl" style="margin:14px 0;border:1px solid #CBD5E1">
          <tr><td style="font-weight:600;width:240px">Registered owner</td><td>${h.receivingCustomer || l.customer}</td></tr>
          <tr><td style="font-weight:600">Vehicle registration</td><td style="font-family:var(--font-mono);font-weight:700">${l.reg}</td></tr>
          <tr><td style="font-weight:600">Original logbook no.</td><td style="font-family:var(--font-mono)">${vault?.logbookNumber || '—'}</td></tr>
          <tr><td style="font-weight:600">NTSA caveat ref</td><td style="font-family:var(--font-mono);color:#0284C7">${vault?.ntsaCaveatRef || '—'}</td></tr>
          <tr><td style="font-weight:600">Release date</td><td>${h.releasedAt || 'Authorised'}</td></tr>
          <tr><td style="font-weight:600">Staff handling release</td><td>${h.staffName || '—'}</td></tr>
          <tr><td style="font-weight:600">Acknowledgement</td><td>${h.acknowledgementRef || 'Pending handover'}</td></tr>
        </table>
        ${signs}${actions}
      `;
    }

    content.innerHTML = body;
    modal.classList.add('active');
  }
};

if (typeof window !== 'undefined') {
  window.LMSModule = LMSModule;
}
