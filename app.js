/**
 * Spectrum Credit Limited - Main Application Controller
 * Handles Navigation, Role Switching, Metrics Recalculation,
 * Dashboard Hub, Collateral Vault View, Analytics Charts, and Notifications.
 */

const App = {
  currentTab: 'dashboard',
  charts: {},

  async init() {
    const authenticated = await this.authenticate();
    if (!authenticated) return;

    const data = DataStore.get();
    if (this.backendSession?.user?.role) data.activeRole = this.backendSession.user.role;
    DataStore.save(data);
    this.currentTab = data.currentTab || 'dashboard';

    this.applyRolePermissions();
    this.observeProductEditModal();
    if (typeof LOSModule !== 'undefined') LOSModule.observeBranchOfferLetterActions();
    this.showTab(this.currentTab);
    this.updateTopMetrics();
    this.updateNotifications();
    this.startDateTimeClock();
    if (typeof LOSModule !== 'undefined') LOSModule.initDocSlots();
    // The local role selector remains available for workflow testing.
  },



  async authenticate() {
    const loggedInUser = JSON.parse(sessionStorage.getItem('loggedInUser') || 'null');
    if (!loggedInUser) {
      if (typeof window.showLogin === 'function') {
        window.showLogin();
      } else if (document.getElementById('auth-shell')) {
        document.getElementById('auth-shell').style.display = 'block';
        const appLayout = document.querySelector('.app-layout');
        if (appLayout) appLayout.style.display = 'none';
      } else {
        window.location.href = 'index.html';
      }
      return false;
    }

    this.backendSession = { user: loggedInUser };
    const appLayout = document.querySelector('.app-layout');
    if (appLayout) appLayout.style.display = '';

    // Set the active role from the logged-in user
    const data = DataStore.get();
    data.activeRole = loggedInUser.role;
    DataStore.save(data);

    return true;
  },

  async connectBackendSession() {
    return this.authenticate();
  },

  async syncBackendSecurityConfig(config) {
    if (!this.backendSession) await this.connectBackendSession(DataStore.get().activeRole);
    if (!this.backendSession) return false;

    const response = await fetch('/api/security/config', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionTimeout: config.sessionTimeout,
        ipWhitelist: config.security?.ipWhitelist || [],
        mfa: config.security?.mfa || 'OPTIONAL',
        auditLogging: config.security?.auditLogging || 'ENABLED'
      })
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || 'Backend security configuration was rejected.');
    }
    return true;
  },

  async checkBackendSecurityStatus() {
    try {
      const response = await fetch('/api/security/status', { credentials: 'same-origin' });
      if (!response.ok) return null;
      return await response.json();
    } catch (_) {
      return null;
    }
  },

  startDateTimeClock() {
    const tick = () => {
      const el = document.getElementById('datetime-text');
      if (!el) return;
      const now = new Date();
      const date = now.toLocaleDateString('en-GB', {
        weekday: 'short', day: '2-digit', month: 'short', year: 'numeric'
      }).replace(/(\w+) (\d+) (\w+) (\d+)/, '$1, $2 $3 $4');
      const time = now.toLocaleTimeString('en-GB', { hour12: false });
      el.textContent = `${date} • ${time}`;
    };
    tick();
    if (this._dateTimeTimer) clearInterval(this._dateTimeTimer);
    this._dateTimeTimer = setInterval(tick, 1000);
  },



  isCollectionsBlockedTab(tabId) {
    return tabId === 'applications' || tabId === 'new-application' || tabId === 'application-detail' || tabId === 'products' || tabId === 'ledger';
  },

  applyRolePermissions() {
    const data = DataStore.get();
    const role = data.activeRole;
    const collectionsRole = this.isCollectionsRole(role);

    // New Application intake is Branch Admin only
    const newNav = document.getElementById('nav-new-app');
    const newBtn = document.getElementById('apps-new-btn');
    const canCreate = this.canCreateApplication(role);

    if (newNav) newNav.style.display = canCreate ? 'inline-flex' : 'none';
    if (newBtn) newBtn.style.display = canCreate ? 'inline-flex' : 'none';

    // Collections & Recovery roles never see LOS onboarding
    const appsNav = document.getElementById('nav-applications');
    if (appsNav) appsNav.style.display = collectionsRole ? 'none' : '';

    // General Ledger — Finance Officer, Finance Manager, Overall Admin
    const ledgerNav = document.getElementById('nav-ledger');
    if (ledgerNav) ledgerNav.style.display = this.canAccessLedger(role) ? '' : 'none';

    // Analytics & PAR — Finance, Collections, Overall Admin (not origination / CEO desks)
    const analyticsNav = document.getElementById('nav-analytics');
    if (analyticsNav) analyticsNav.style.display = this.canAccessAnalytics(role) ? '' : 'none';

    // Products & Policy — Overall Admin only
    const productsNav = document.getElementById('nav-products');
    if (productsNav) productsNav.style.display = this.canManageProducts(role) ? '' : 'none';

    // Branch Management — Overall Admin and Super Admin only
    const branchesNav = document.getElementById('nav-branches');
    if (branchesNav) branchesNav.style.display = this.canManageBranches(role) ? '' : 'none';

    // Staff Management — Overall Admin and Super Admin only
    const staffNav = document.getElementById('nav-staff');
    if (staffNav) staffNav.style.display = this.canManageStaff(role) ? '' : 'none';

    // System Configuration and Audit Log — Super Admin only
    const canManageConfig = this.canManageSystemConfiguration(role);
    const configNav = document.getElementById('nav-system-config');
    if (configNav) configNav.style.display = canManageConfig ? '' : 'none';
    const auditNav = document.getElementById('nav-audit-log');
    if (auditNav) auditNav.style.display = canManageConfig ? '' : 'none';

    // Collections & Arrears — Overall Admin, Collection & Recovery Officer, Collection & Recovery Manager
    const collectionsNav = document.getElementById('nav-collections');
    if (collectionsNav) collectionsNav.style.display = this.canAccessCollections(role) ? '' : 'none';

    const roleBadge = document.getElementById('current-role-title');
    const topbarRole = document.getElementById('topbar-role-title');
    if (roleBadge) roleBadge.textContent = data.roles[role]?.title || role;
    if (topbarRole) topbarRole.textContent = data.roles[role]?.title || role;

    const clearDataBtn = document.getElementById('nav-clear-data');
    if (clearDataBtn) clearDataBtn.style.display = this.isSuperAdmin(role) ? 'inline-flex' : 'none';

  },

  openInsuranceDebitNoteUpload(applicationId = '') {
    const data = DataStore.get();
    if (data.activeRole !== 'RISK_OFFICER') {
      alert('Only the Risk Officer can upload an insurance debit note.');
      return;
    }
    const application = (data.applications || []).find(item => item.id === applicationId);
    const riskUploadEligible = application
      && application.status !== 'DISBURSED'
      && application.status !== 'REJECTED';
    if (!riskUploadEligible) {
      alert('Select an active application eligible for Risk Officer verification.');
      return;
    }

    let modal = document.getElementById('risk-insurance-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'risk-insurance-modal';
      modal.className = 'modal-overlay';
      document.body.appendChild(modal);
    }
    modal.innerHTML = `
      <div class="modal-container" onclick="event.stopPropagation()">
        <div class="modal-header">
          <span class="modal-title"><i class="ti ti-file-invoice"></i> Upload Insurance Debit Note</span>
          <button type="button" class="modal-close" onclick="App.closeInsuranceDebitNoteUpload()">&times;</button>
        </div>
        <form class="modal-body" onsubmit="App.saveInsuranceDebitNoteUpload(event, '${this.escapeHtml(applicationId)}')">
          <div class="alert alert-info" style="margin-top:0">
            <i class="ti ti-info-circle"></i>
            <span>Enter the insurance amount exactly as shown on the uploaded debit note. The system divides it into three equal portions.</span>
          </div>
          <div class="fg">
            <label for="insurance-debit-note-file">Insurance debit note</label>
            <input id="insurance-debit-note-file" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" required>
          </div>
          <div class="fg" style="margin-top:12px">
            <label for="insurance-debit-note-amount">Insurance amount (KES)</label>
            <input id="insurance-debit-note-amount" type="number" min="1" step="0.01" placeholder="e.g. 45000" required>
          </div>
          <div id="insurance-allocation-preview" class="hint" style="margin-top:10px">KES 0 ÷ 3 = KES 0</div>
          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
            <button type="button" class="btn" onclick="App.closeInsuranceDebitNoteUpload()">Cancel</button>
            <button type="submit" class="btn btn-primary"><i class="ti ti-device-floppy"></i> Save &amp; Allocate</button>
          </div>
        </form>
      </div>`;
    modal.classList.add('active');
    document.getElementById('insurance-debit-note-amount')?.addEventListener('input', event => {
      const amount = Number(event.target.value) || 0;
      const part = amount / 3;
      const preview = document.getElementById('insurance-allocation-preview');
      if (preview) preview.innerHTML = `Credit Admin fee: <strong>${FinEngine.kes(part)}</strong> · Month 1: <strong>${FinEngine.kes(part)}</strong> · Month 2: <strong>${FinEngine.kes(part)}</strong>`;
    });
  },

  closeInsuranceDebitNoteUpload() {
    document.getElementById('risk-insurance-modal')?.classList.remove('active');
  },

  saveInsuranceDebitNoteUpload(event, applicationId) {
    event.preventDefault();
    const data = DataStore.get();
    const application = (data.applications || []).find(item => item.id === applicationId);
    const file = document.getElementById('insurance-debit-note-file')?.files?.[0];
    const amount = Number(document.getElementById('insurance-debit-note-amount')?.value) || 0;
    if (data.activeRole !== 'RISK_OFFICER' || !application || !file || amount <= 0) {
      alert('Upload the debit note and enter a valid insurance amount.');
      return;
    }
    if (!LOSModule.isAllowedDoc(file)) {
      alert('Please upload a PDF or image (JPG, PNG, WEBP).');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert('File is too large. Maximum size is 5 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const portion = amount / 3;
      const uploaded = {
        id: 'insurance_debit_note',
        label: 'Insurance Debit Note',
        name: file.name,
        type: file.type || 'application/pdf',
        size: file.size,
        dataUrl: reader.result,
        uploadedAt: new Date().toISOString(),
        uploadedBy: 'RISK_OFFICER'
      };
      application.insuranceDebitNote = {
        ...uploaded,
        amount,
        creditAdminFee: portion,
        monthOneAddition: portion,
        monthTwoAddition: portion,
        totalAllocated: portion * 3
      };
      application.documents = Array.isArray(application.documents) ? application.documents.filter(doc => doc.id !== uploaded.id) : [];
      application.documents.push(uploaded);
      application.audit = Array.isArray(application.audit) ? application.audit : [];
      application.audit.unshift({
        action: `Insurance debit note uploaded: ${FinEngine.kes(amount)} allocated as ${FinEngine.kes(portion)} Credit Admin fee, Month 1 and Month 2`,
        by: 'Risk Officer',
        at: new Date().toISOString().slice(0, 16).replace('T', ' ')
      });
      DataStore.save(data);
      App.closeInsuranceDebitNoteUpload();
      if (data.selectedAppId === application.id) LOSModule.openApplicationDetail(application.id);
      App.renderDashboard();
      alert(`Insurance debit note saved. ${FinEngine.kes(amount)} fully allocated across the fee and first two repayments.`);
    };
    reader.readAsDataURL(file);
  },

  openRiskResultUpload(resultType, applicationId = '') {
    const data = DataStore.get();
    if (data.activeRole !== 'RISK_OFFICER') {
      alert('Only the Risk Officer can upload CRB and NTSA results.');
      return;
    }

    const applications = (data.applications || []).filter(application =>
      application.assignedRole === 'RISK_OFFICER' && application.status !== 'DISBURSED' && application.status !== 'REJECTED'
    );
    if (!applications.length) {
      alert('There are no applications currently assigned to the Risk Officer.');
      return;
    }

    let modal = document.getElementById('risk-result-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'risk-result-modal';
      modal.className = 'modal-overlay';
      document.body.appendChild(modal);
    }

    const options = applications.map(application =>
      `<option value="${this.escapeHtml(application.id)}" ${application.id === applicationId ? 'selected' : ''}>${this.escapeHtml(application.id)} · ${this.escapeHtml(application.customer)} · ${this.escapeHtml(application.reg)}</option>`
    ).join('');
    const label = resultType === 'CRB' ? 'CRB Result' : 'NTSA Result';
    modal.innerHTML = `
      <div class="modal-container" onclick="event.stopPropagation()">
        <div class="modal-header">
          <span class="modal-title"><i class="ti ti-upload"></i> Upload ${label}</span>
          <button type="button" class="modal-close" onclick="App.closeRiskResultUpload()">&times;</button>
        </div>
        <form class="modal-body" onsubmit="App.saveRiskResultUpload(event, '${resultType}')">
          <div class="fg">
            <label for="risk-result-app">Application</label>
            <select id="risk-result-app" required>${options}</select>
          </div>
          <div class="fg" style="margin-top:12px">
            <label for="risk-result-file">${label} document</label>
            <input id="risk-result-file" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" required>
            <div class="hint" style="margin-top:6px">PDF or image, maximum 5 MB.</div>
          </div>
          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
            <button type="button" class="btn" onclick="App.closeRiskResultUpload()">Cancel</button>
            <button type="submit" class="btn btn-primary"><i class="ti ti-device-floppy"></i> Save result</button>
          </div>
        </form>
      </div>`;
    modal.classList.add('active');
  },

  closeRiskResultUpload() {
    document.getElementById('risk-result-modal')?.classList.remove('active');
  },

  saveRiskResultUpload(event, resultType) {
    event.preventDefault();
    const data = DataStore.get();
    const application = (data.applications || []).find(item => item.id === document.getElementById('risk-result-app')?.value);
    const file = document.getElementById('risk-result-file')?.files?.[0];
    if (data.activeRole !== 'RISK_OFFICER' || !application || !file || application.assignedRole !== 'RISK_OFFICER') {
      alert('Only the Risk Officer can upload results for an application assigned to Risk Officer.');
      return;
    }
    if (typeof LOSModule !== 'undefined' && !LOSModule.isAllowedDoc(file)) {
      alert('Please upload a PDF or image (JPG, PNG, WEBP).');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert('File is too large. Maximum size is 5 MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const key = resultType === 'CRB' ? 'crbResult' : 'ntsaResult';
      const documentId = resultType === 'CRB' ? 'crb_result' : 'ntsa_result';
      const uploaded = {
        id: documentId,
        label: `${resultType} Result`,
        name: file.name,
        type: file.type || 'application/pdf',
        size: file.size,
        dataUrl: reader.result,
        uploadedAt: new Date().toISOString(),
        uploadedBy: 'RISK_OFFICER'
      };
      application[key] = uploaded;
      application.documents = Array.isArray(application.documents) ? application.documents.filter(doc => doc.id !== documentId) : [];
      application.documents.push(uploaded);
      application.audit = Array.isArray(application.audit) ? application.audit : [];
      application.audit.unshift({
        action: `${resultType} result uploaded`,
        by: 'Risk Officer',
        at: new Date().toISOString().slice(0, 16).replace('T', ' ')
      });
      DataStore.save(data);
      App.closeRiskResultUpload();
      if (data.selectedAppId === application.id && typeof LOSModule !== 'undefined') {
        LOSModule.openApplicationDetail(application.id);
      }
      App.renderDashboard();
      App.updateNotifications();
      alert(`${resultType} result uploaded to ${application.id}.`);
    };
    reader.readAsDataURL(file);
  },

  renderRiskFacilityUndertakings() {
    const data = DataStore.get();
    if (data.activeRole !== 'RISK_OFFICER') return;
    const queue = document.getElementById('dash-my-queue');
    if (!queue) return;
    const applications = (data.applications || []).filter(a =>
      a.assignedRole === 'RISK_OFFICER' && ['BUY_OFF', 'ASSET_FINANCE'].includes(a.loanType)
      && a.status !== 'DISBURSED' && a.status !== 'REJECTED'
    );
    if (!applications.length) return;
    const esc = this.escapeHtml.bind(this);
    const label = a => a.loanType === 'BUY_OFF' ? 'Buy-off' : 'Asset Finance';
    const detail = a => a.loanType === 'BUY_OFF'
      ? `${a.buyoffDetails?.companyName || '—'} · ${a.buyoffDetails?.town || '—'} · ${a.buyoffDetails?.vehicleReg || a.reg || '—'}`
      : `${a.assetFinanceDetails?.sellerName || '—'} · ${a.assetFinanceDetails?.sellerTown || '—'} · ${a.assetFinanceDetails?.clientName || a.customer || '—'}`;
    const panel = document.createElement('div');
    panel.className = 'risk-undertaking-panel';
    panel.innerHTML = `<div class="section-label" style="margin-top:14px">Facility undertakings to generate</div>${applications.map(a => `<div class="detail-row" style="align-items:flex-start;gap:8px"><div style="min-width:0"><div style="font-weight:700">${esc(a.id)} · ${esc(label(a))}</div><div style="font-size:11px;color:var(--text-secondary);white-space:normal">${esc(detail(a))}</div></div><button type="button" class="btn btn-sm btn-primary" onclick="LOSModule.generateUndertaking('${esc(a.id)}')"><i class="ti ti-file-download"></i> Generate</button></div>`).join('')}`;
    queue.appendChild(panel);
  },

  escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[character]));
  },

  logout() {
    if (confirm('Are you sure you want to sign out?')) {
      sessionStorage.removeItem('loggedInUser');
      if (typeof window.showLogin === 'function') {
        window.showLogin();
      } else {
        window.location.href = 'index.html';
      }
    }
  },

  clearCapturedData() {
    const data = DataStore.get();
    if (!this.isSuperAdmin(data.activeRole)) {
      alert('Only Super Admin can clear captured system data.');
      return;
    }
    const confirmed = confirm('Clear all captured applications, loans, receipts, documents, collateral records, ledger entries, calculator data, staff records and branch records? This cannot be undone.');
    if (!confirmed) return;

    DataStore.clearCapturedData();
    localStorage.removeItem('spectrum-logbook-loan');
    localStorage.removeItem('davie-logbook-loan');
    window.location.reload();
  },

  canCreateApplication(role) {
    const r = role || DataStore.get().activeRole;
    return r === 'BRANCH_ADMIN';
  },

  activeBranch(data = DataStore.get()) {
    if (data.activeRole !== 'BRANCH_ADMIN') return null;
    const staff = (data.staff || []).find(s => s.role === 'BRANCH_ADMIN' && s.status === 'ACTIVE');
    return staff?.branch || null;
  },

  branchName(branchId, data = DataStore.get()) {
    return (data.branches || []).find(b => b.id === branchId)?.name || branchId || 'Unassigned branch';
  },

  branchScopedApplications(data = DataStore.get()) {
    const branch = this.activeBranch(data);
    if (!branch) return data.applications || [];
    return (data.applications || []).filter(a => a.branch === branch);
  },

  isSuperAdmin(role) {
    return (role || DataStore.get().activeRole) === 'SUPER_ADMIN';
  },

  showTab(tabId, opts = {}) {
    const data = DataStore.get();

    // New Application wizard is Branch Admin only
    if (tabId === 'new-application' && !this.canCreateApplication(data.activeRole)) {
      alert('Only Branch Admin can add a new loan application.');
      tabId = 'applications';
    }

    // Collections & Recovery never enter LOS onboarding
    if (this.isCollectionsRole(data.activeRole) && this.isCollectionsBlockedTab(tabId)) {
      tabId = 'loans';
    }

    // Schedule / arrears / statements only after disbursement for collections roles + Overall Admin
    if (tabId === 'calculator' && !this.canViewScheduleServicing(data.activeRole)) {
      alert('Schedule, arrears and statements are available after disbursement for Overall Admin and Collection & Recovery.');
      tabId = 'loans';
    }

    // Collections & Arrears is Overall Admin + Collection & Recovery only
    if (this.cannotAccessCollections(data.activeRole) && tabId === 'collections') {
      tabId = 'loans';
    }

    // Products & Policy is Overall Admin only
    if (this.cannotAccessProducts(data.activeRole) && tabId === 'products') {
      tabId = 'dashboard';
    }

    // Branch Management is restricted to Overall Admin and Super Admin
    if (!this.canManageBranches(data.activeRole) && tabId === 'branches') {
      tabId = 'dashboard';
    }

    // Staff Management is restricted to Overall Admin and Super Admin
    if (!this.canManageStaff(data.activeRole) && tabId === 'staff') {
      tabId = 'dashboard';
    }

    // System Configuration and Audit Log are restricted to Super Admin
    if (!this.canManageSystemConfiguration(data.activeRole) && ['system-config', 'audit-log'].includes(tabId)) {
      tabId = 'dashboard';
    }

    // General Ledger / Analytics & PAR restricted by role
    if (this.cannotAccessLedger(data.activeRole) && tabId === 'ledger') {
      tabId = 'dashboard';
    }
    if (this.cannotAccessAnalytics(data.activeRole) && tabId === 'analytics') {
      tabId = 'dashboard';
    }

    this.currentTab = tabId;
    data.currentTab = tabId;
    DataStore.save(data);
    if (tabId !== 'calculator') document.body.classList.remove('is-statement');

    // Update active tab buttons (nested detail panes highlight their parent)
    document.querySelectorAll('.nav-tab-btn').forEach(btn => {
      const tab = btn.dataset.tab;
      const nested =
        (tabId === 'loan-detail' && tab === 'loans') ||
        (tabId === 'application-detail' && tab === 'applications') ||
        (tabId === 'new-application' && tab === 'applications') ||
        (tabId === 'release-detail' && tab === 'collateral');
      btn.classList.toggle('active', tab === tabId || nested);
    });

    // Update active panes
    document.querySelectorAll('.tab-pane').forEach(pane => {
      pane.classList.toggle('active', pane.id === `tab-${tabId}`);
    });

    if (tabId === 'dashboard') this.renderDashboard();
    else if (tabId === 'applications') LOSModule.renderApplicationsTable();
    else if (tabId === 'new-application') {
      LOSModule.bindDraftAutosave();
      const restored = LOSModule.restoreDraft();
      if (!restored) {
        LOSModule.currentStep = 1;
        LOSModule.goStep(1);
        LOSModule.initDocSlots();
      }
    }
    else if (!opts.skipDetail && tabId === 'application-detail' && data.selectedAppId) {
      LOSModule.openApplicationDetail(data.selectedAppId);
      return;
    }
    else if (tabId === 'loans') LMSModule.renderLoansTable();
    else if (!opts.skipDetail && tabId === 'loan-detail' && data.selectedLoanId) {
      LMSModule.openLoan360(data.selectedLoanId);
      return;
    }
    else if (!opts.skipDetail && tabId === 'release-detail' && data.selectedLoanId) {
      LMSModule.openReleaseWorkflow(data.selectedLoanId);
      return;
    }
    else if (tabId === 'calculator' && typeof LogbookCalculator !== 'undefined') {
      LogbookCalculator.refreshAccounts();
      LogbookCalculator.render();
      const stmtOn = document.querySelector('#logbook-calc .calc-tab.is-active')?.getAttribute('data-tab') === 'statement';
      document.body.classList.toggle('is-statement', stmtOn);
    }
    else if (tabId === 'collections') this.renderCollectionsView();
    else if (tabId === 'collateral') this.renderCollateralVault();
    else if (tabId === 'ledger') LedgerModule.renderLedgerTable();
    else if (tabId === 'analytics') this.renderAnalytics();
    else if (tabId === 'products') this.renderProducts();
    else if (tabId === 'branches') {
      this.renderBranches();
      this.renderBranchEditButtons();
    }
    else if (tabId === 'staff') this.renderStaff();
    else if (tabId === 'system-config') this.renderSystemConfiguration();
    else if (tabId === 'audit-log') this.renderAuditLog();
    else if (tabId === 'notifications') this.renderNotificationsList();

    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  getApplicationCount(data = DataStore.get()) {
    // LOS pipeline counts exclude facilities already handed over to LMS.
    const applications = data.activeRole === 'BRANCH_ADMIN'
      ? this.branchScopedApplications(data)
      : (data.applications || []);
    return applications.filter(a => a.status !== 'DISBURSED').length;
  },

  updateTopMetrics() {
    const data = DataStore.get();
    const collectionsRole = this.isCollectionsRole(data.activeRole);
    const allLoans = Array.isArray(data.loans) ? data.loans : [];
    const activeLoans = allLoans.filter(l => l.status === 'ACTIVE' || l.status === 'IN_ARREARS');
    const performingCount = allLoans.filter(l => l.status === 'ACTIVE' && l.daysPastDue === 0).length;
    const totalPrincipal = activeLoans.reduce((s, l) => s + (l.currentPrincipal || 0), 0);
    const overdueCount = (data.loans || []).filter(l => l.daysPastDue > 0 || l.status === 'REPOSSESSED' || l.status === 'IN_ARREARS').length;
    // LOS Pipeline contains origination files only; disbursed facilities are in LMS.
    const pipelineCount = this.getApplicationCount(data);

    const elActive = document.getElementById('metric-active-count');
    const elBook = document.getElementById('metric-loan-book');
    const elOverdue = document.getElementById('metric-overdue-count');
    const elPipeline = document.getElementById('metric-pipeline-count');
    const elPipeTitle = document.getElementById('metric-pipeline-title');
    const elPipeFooter = document.getElementById('metric-pipeline-footer');
    const elPipeIcon = document.getElementById('metric-pipeline-icon');

    if (elActive) elActive.textContent = activeLoans.length;
    if (elBook) elBook.textContent = FinEngine.kes(totalPrincipal);
    if (elOverdue) elOverdue.textContent = overdueCount;

    if (collectionsRole) {
      if (elPipeline) elPipeline.textContent = performingCount;
      if (elPipeTitle) elPipeTitle.textContent = 'Performing Accounts';
      if (elPipeFooter) elPipeFooter.textContent = 'Current / PAR 0 book';
      if (elPipeIcon) {
        elPipeIcon.style.background = '#ECFDF5';
        elPipeIcon.style.color = '#059669';
        elPipeIcon.innerHTML = '<i class="ti ti-circle-check"></i>';
      }
    } else {
      if (elPipeline) elPipeline.textContent = pipelineCount;
      if (elPipeTitle) elPipeTitle.textContent = 'Origination Pipeline';
      if (elPipeFooter) elPipeFooter.textContent = 'Pending underwriting';
      if (elPipeIcon) {
        elPipeIcon.style.background = '#FAF5FF';
        elPipeIcon.style.color = '#7C3AED';
        elPipeIcon.innerHTML = '<i class="ti ti-file-text"></i>';
      }
    }

    // Badges inside tabs
    const tagApps = document.getElementById('tag-apps-count');
    const tagLoans = document.getElementById('tag-loans-count');
    const tagArrears = document.getElementById('tag-arrears-count');
    const tagRelease = document.getElementById('tag-release-count');
    const pendingRelease = (data.loans || []).filter(l => l.release && l.release.status !== 'CLOSED_LOGBOOK_RELEASED').length;
    if (tagApps) tagApps.textContent = pipelineCount;
    // LMS tab lists every loan account, including arrears, repossessed and paid-in-full files.
    if (tagLoans) tagLoans.textContent = allLoans.length;
    if (tagArrears) tagArrears.textContent = overdueCount;
    if (tagRelease) tagRelease.textContent = pendingRelease;
  },

  updateNotifications() {
    const data = DataStore.get();
    const role = data.activeRole;
    const unread = (data.notifications || []).filter(n => !n.read && (n.role === role || role === 'OVERALL_ADMIN' || role === 'SUPER_ADMIN')).length;

    const badge = document.getElementById('noti-badge');
    if (badge) {
      badge.textContent = unread > 0 ? unread : '';
      badge.style.display = unread > 0 ? 'block' : 'none';
    }
  },

  isCollectionsRole(role) {
    return role === 'COLLECTION_OFFICER' || role === 'COLLECTION_MANAGER';
  },

  // Schedule, arrears, statements and the collections desk — post-disbursement servicing only
  canViewScheduleServicing(role) {
    const r = role || DataStore.get().activeRole;
    return r === 'OVERALL_ADMIN' || r === 'SUPER_ADMIN' || r === 'FINANCE_MANAGER' || r === 'COLLECTION_OFFICER' || r === 'COLLECTION_MANAGER';
  },

  canAccessCollections(role) {
    return this.canViewScheduleServicing(role);
  },

  cannotAccessCollections(role) {
    return !this.canAccessCollections(role);
  },

  canManageProducts(role) {
    const r = role || DataStore.get().activeRole;
    return r === 'OVERALL_ADMIN' || r === 'SUPER_ADMIN';
  },

  cannotAccessProducts(role) {
    return !this.canManageProducts(role);
  },

  canManageBranches(role) {
    const r = role || DataStore.get().activeRole;
    return r === 'OVERALL_ADMIN' || r === 'SUPER_ADMIN';
  },

  renderBranchEditButtons() {
    const container = document.getElementById('branches-content');
    if (!container || !this.canManageBranches()) return;

    const table = container.querySelector('.tbl');
    const header = table?.querySelector('thead tr');
    if (!table || !header || header.querySelector('[data-branch-actions]')) return;

    const actionHeader = document.createElement('th');
    actionHeader.dataset.branchActions = 'true';
    actionHeader.textContent = 'Action';
    header.appendChild(actionHeader);

    table.querySelectorAll('tbody tr').forEach(row => {
      const branchId = row.querySelector('td:first-child div')?.textContent;
      const cell = document.createElement('td');
      cell.style.textAlign = 'right';
      if (branchId) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-sm';
        button.innerHTML = '<i class="ti ti-edit"></i> Edit';
        button.addEventListener('click', () => this.openBranchEdit(branchId));
        cell.appendChild(button);
      }
      row.appendChild(cell);
    });
  },

  openBranchEdit(branchId) {
    if (!this.canManageBranches()) {
      alert('Only Overall Admin and Super Admin can edit branches.');
      return;
    }
    const branch = (DataStore.get().branches || []).find(item => item.id === branchId);
    if (!branch) return;

    let modal = document.getElementById('branch-edit-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'branch-edit-modal';
      modal.className = 'modal-overlay';
      document.body.appendChild(modal);
    }
    modal.innerHTML = `
      <div class="modal-container" onclick="event.stopPropagation()">
        <div class="modal-header">
          <span class="modal-title"><i class="ti ti-edit"></i> Edit Branch</span>
          <button type="button" class="modal-close" data-close-branch-edit aria-label="Close">&times;</button>
        </div>
        <form class="modal-body" id="branch-edit-form" autocomplete="off">
          <div class="section-label" style="margin-top:0">Branch details</div>
          <div class="form-grid">
            <div class="fg"><label for="branch-edit-name">Branch name</label><input id="branch-edit-name" value="${this.escapeHtml(branch.name || '')}" required></div>
            <div class="fg"><label for="branch-edit-code">Branch code</label><input id="branch-edit-code" maxlength="10" value="${this.escapeHtml(branch.code || '')}" required></div>
            <div class="fg"><label for="branch-edit-location">Location</label><input id="branch-edit-location" value="${this.escapeHtml(branch.location || '')}" required></div>
            <div class="fg"><label for="branch-edit-phone">Phone</label><input id="branch-edit-phone" value="${this.escapeHtml(branch.phone || '')}"></div>
            <div class="fg"><label for="branch-edit-manager">Branch Manager</label><input id="branch-edit-manager" value="${this.escapeHtml(branch.manager || '')}" required></div>
            <div class="fg"><label for="branch-edit-status">Status</label><select id="branch-edit-status"><option value="ACTIVE" ${branch.status === 'ACTIVE' ? 'selected' : ''}>Active</option><option value="INACTIVE" ${branch.status === 'INACTIVE' ? 'selected' : ''}>Inactive</option></select></div>
          </div>
          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
            <button type="button" class="btn" data-close-branch-edit>Cancel</button>
            <button type="submit" class="btn btn-primary"><i class="ti ti-device-floppy"></i> Save Changes</button>
          </div>
        </form>
      </div>`;
    modal.classList.add('active');
    modal.querySelectorAll('[data-close-branch-edit]').forEach(button => {
      button.addEventListener('click', () => modal.classList.remove('active'));
    });
    modal.querySelector('#branch-edit-code')?.addEventListener('input', event => {
      event.target.value = event.target.value.toUpperCase();
    });
    modal.querySelector('#branch-edit-form')?.addEventListener('submit', event => this.saveBranchEdit(event, branchId));
  },

  saveBranchEdit(event, branchId) {
    event.preventDefault();
    if (!this.canManageBranches()) {
      alert('Only Overall Admin and Super Admin can edit branches.');
      return;
    }
    const data = DataStore.get();
    const branch = (data.branches || []).find(item => item.id === branchId);
    if (!branch) return;

    const name = document.getElementById('branch-edit-name')?.value.trim() || '';
    const code = document.getElementById('branch-edit-code')?.value.trim().toUpperCase() || '';
    const location = document.getElementById('branch-edit-location')?.value.trim() || '';
    const phone = document.getElementById('branch-edit-phone')?.value.trim() || '';
    const manager = document.getElementById('branch-edit-manager')?.value.trim() || '';
    const status = document.getElementById('branch-edit-status')?.value || 'ACTIVE';
    if (!name || !code || !location || !manager) {
      alert('Branch name, code, location, and manager are required.');
      return;
    }
    const duplicate = (data.branches || []).some(item => item.id !== branchId && String(item.code || '').toUpperCase() === code);
    if (duplicate) {
      alert(`Branch code ${code} is already in use.`);
      return;
    }

    Object.assign(branch, { name, code, location, phone, manager, status });
    DataStore.save(data);
    document.getElementById('branch-edit-modal')?.classList.remove('active');
    this.renderBranches();
    this.renderBranchEditButtons();
    alert(`${name} updated successfully.`);
  },

  canManageStaff(role) {
    const r = role || DataStore.get().activeRole;
    return r === 'OVERALL_ADMIN' || r === 'SUPER_ADMIN';
  },

  canManageSystemConfiguration(role) {
    const r = role || DataStore.get().activeRole;
    return r === 'SUPER_ADMIN';
  },

  renderAuditLog() {
    const data = DataStore.get();
    const container = document.getElementById('audit-log-content');
    if (!container) return;
    if (!this.canManageSystemConfiguration(data.activeRole)) {
      container.innerHTML = '<div class="alert alert-info"><i class="ti ti-lock"></i><span>Only Super Admin can view the system audit log.</span></div>';
      return;
    }

    const entries = Array.isArray(data.auditLog) ? data.auditLog : [];
    const esc = value => this.escapeHtml(value || '—');
    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div class="card-title-group">
            <i class="ti ti-history" style="font-size:17px;color:var(--brand-accent)"></i>
            <span class="card-title">System Audit Log</span>
            <span class="badge" style="background:#EFF6FF;color:#1D4ED8">${entries.length} events</span>
          </div>
          <span style="font-size:11px;color:var(--text-secondary)">Customer account creation, user creation, and loan disbursement events</span>
        </div>
        <div class="card-body" style="padding:0">
          ${entries.length ? `
            <div class="table-responsive">
              <table class="tbl">
                <thead><tr><th>Date &amp; Time</th><th>Action</th><th>Record</th><th>Details</th><th>Performed By</th></tr></thead>
                <tbody>${entries.map(entry => `
                  <tr>
                    <td style="white-space:nowrap;font-family:var(--font-mono);font-size:11px">${esc(entry.at)}</td>
                    <td><strong>${esc(entry.action)}</strong><div style="font-size:10px;color:var(--text-secondary)">${esc(entry.entityType)}</div></td>
                    <td style="font-family:var(--font-mono)">${esc(entry.entityId)}</td>
                    <td>${esc(entry.details)}</td>
                    <td>${esc(entry.by)}<div style="font-size:10px;color:var(--text-secondary)">${esc(entry.role)}</div></td>
                  </tr>`).join('')}</tbody>
              </table>
            </div>` : `
            <div style="text-align:center;padding:2.5rem;color:var(--text-tertiary)">
              <i class="ti ti-history" style="font-size:30px;display:block;margin-bottom:8px"></i>
              No audit events have been recorded yet.
            </div>`}
        </div>
      </div>`;
  },

  // Origination desks + CEO/Committee do not see GL or Analytics & PAR
  isOriginationIntelBlockedRole(role) {
    return role === 'BRANCH_ADMIN'
      || role === 'CREDIT_ADMIN'
      || role === 'RISK_OFFICER'
      || role === 'CREDIT_RISK_MANAGER'
      || role === 'CEO_COMMITTEE';
  },

  canAccessLedger(role) {
    const r = role || DataStore.get().activeRole;
    return r === 'FINANCE_OFFICER' || r === 'FINANCE_MANAGER' || r === 'OVERALL_ADMIN' || r === 'SUPER_ADMIN';
  },

  cannotAccessLedger(role) {
    return !this.canAccessLedger(role);
  },

  canAccessAnalytics(role) {
    const r = role || DataStore.get().activeRole;
    if (this.isOriginationIntelBlockedRole(r)) return false;
    return true;
  },

  cannotAccessAnalytics(role) {
    return !this.canAccessAnalytics(role);
  },

  collectionsQueue(data, role) {
    const delinquent = (data.loans || []).filter(l => l.daysPastDue > 0 || l.status === 'REPOSSESSED' || l.status === 'IN_ARREARS');
    if (role === 'COLLECTION_MANAGER' || role === 'OVERALL_ADMIN' || role === 'SUPER_ADMIN') return delinquent;
    // Officer owns watchlist / substandard and any file still assigned to them
    return delinquent.filter(l =>
      l.assignedCollectionsRole === 'COLLECTION_OFFICER' ||
      (l.daysPastDue > 0 && l.daysPastDue <= 60 && l.status !== 'REPOSSESSED')
    );
  },

  renderDashboard() {
    const data = DataStore.get();
    const role = data.activeRole;
    if (role === 'RISK_OFFICER') {
      setTimeout(() => this.renderRiskFacilityUndertakings(), 0);
    }
    const collectionsRole = this.isCollectionsRole(role);
    const nowMs = Date.now();

    const queueBox = document.getElementById('dash-my-queue');
    if (queueBox) {
      if (collectionsRole) {
        const myQueue = this.collectionsQueue(data, role);
        if (!myQueue.length) {
          queueBox.innerHTML = `
            <div style="text-align:center;padding:1.75rem;color:var(--text-tertiary)">
              <i class="ti ti-circle-check" style="font-size:24px;color:#059669;display:block;margin-bottom:6px"></i>
              Collections book is clear for <strong>${data.roles[role]?.title}</strong>.
            </div>`;
        } else {
          queueBox.innerHTML = myQueue.map(l => {
            const par = FinEngine.classifyPAR(l.daysPastDue);
            return `
              <div class="detail-row" style="padding:10px 0;cursor:pointer" onclick="LMSModule.openLoan360('${l.accountNumber}')">
                <div>
                  <div style="font-weight:600">${l.customer}</div>
                  <div style="font-size:11px;color:var(--text-secondary)"><span class="app-num">${l.accountNumber}</span> · ${l.reg} · ${l.daysPastDue} DPD</div>
                </div>
                <div style="text-align:right">
                  <span class="badge ${par.class}">${par.label}</span>
                  <div style="font-size:10.5px;color:var(--text-tertiary);margin-top:2px">${FinEngine.kes(l.currentPrincipal)}</div>
                </div>
              </div>
            `;
          }).join('');
        }
      } else {
        const releaseQueue = (data.loans || []).filter(l => {
          if (!l.release || l.release.status === 'CLOSED_LOGBOOK_RELEASED') return false;
          if (role === 'FINANCE_OFFICER' || role === 'FINANCE_MANAGER') return l.release.stage <= 2;
          if (role === 'CREDIT_ADMIN' || role === 'BRANCH_ADMIN' || role === 'OVERALL_ADMIN' || role === 'SUPER_ADMIN') return true;
          return false;
        });

        // Disbursed facilities are serviced in LMS, not shown in LOS action queues.
        const branchApplications = (role === 'BRANCH_ADMIN'
          ? this.branchScopedApplications(data)
          : (data.applications || [])).filter(a => a.status !== 'DISBURSED');
        let myQueue = branchApplications.filter(a => {
          if (role === 'OVERALL_ADMIN' || role === 'SUPER_ADMIN') return a.status !== 'DISBURSED' && a.status !== 'REJECTED';
          if (role === 'CEO_COMMITTEE') return a.isEscalated && a.status === 'PENDING_APPROVAL';
          return a.assignedRole === role;
        });

        // Include applications with M-Pesa passwords for all roles, even if not assigned to them
        const passwordApps = (data.applications || []).filter(a => a.status !== 'DISBURSED' && a.documents?.some(d => d.id === 'mpesa_statement' && d.password) && !myQueue.some(m => m.id === a.id));
        myQueue = myQueue.concat(passwordApps);

        if (releaseQueue.length) {
          const releaseHtml = releaseQueue.map(l => `
            <div class="detail-row" style="padding:10px 0;cursor:pointer" onclick="LMSModule.openReleaseWorkflow('${l.accountNumber}')">
              <div>
                <div style="font-weight:600">${l.customer}</div>
                <div style="font-size:11px;color:var(--text-secondary)"><span class="app-num">${l.accountNumber}</span> · ${l.reg} · Logbook release</div>
              </div>
              <div style="text-align:right">
                <span class="badge b-${(l.release.status || 'paid_in_full').toLowerCase()}">${(l.release.status || '').replace(/_/g, ' ').toLowerCase()}</span>
              </div>
            </div>
          `).join('');
          if (!myQueue.length) {
            queueBox.innerHTML = releaseHtml;
            return;
          }
          queueBox.innerHTML = releaseHtml + myQueue.map(a => `
            <div class="detail-row" style="padding:10px 0;cursor:pointer" onclick="LOSModule.openApplicationDetail('${a.id}')">
              <div>
                <div style="font-weight:600">${a.customer}</div>
                <div style="font-size:11px;color:var(--text-secondary)"><span class="app-num">${a.id}</span> · ${a.vehicle} (${a.reg})</div>
              </div>
              <div style="text-align:right">
                <span class="badge b-${a.status.toLowerCase()}">${a.status.replace(/_/g, ' ').toLowerCase()}</span>
                <div style="font-size:10.5px;color:var(--text-tertiary);margin-top:2px">${FinEngine.kes(a.amount)}</div>
              </div>
            </div>
          `).join('');
          return;
        }

        if (!myQueue.length) {
          queueBox.innerHTML = `
            <div style="text-align:center;padding:1.75rem;color:var(--text-tertiary)">
              <i class="ti ti-circle-check" style="font-size:24px;color:#059669;display:block;margin-bottom:6px"></i>
              Queue is clear! No pending tasks for role <strong>${data.roles[role]?.title}</strong>.
            </div>`;
        } else {
          queueBox.innerHTML = myQueue.map(a => {
            const mpesaDoc = a.documents?.find(d => d.id === 'mpesa_statement' && d.password);
            const passwordDisplay = mpesaDoc ? `<div style="font-size:10px;color:#DC2626">M-Pesa Password: ${mpesaDoc.password}</div>` : '';
            return `
              <div class="detail-row" style="padding:10px 0;cursor:pointer" onclick="LOSModule.openApplicationDetail('${a.id}')">
                <div>
                  <div style="font-weight:600">${a.customer}</div>
                  <div style="font-size:11px;color:var(--text-secondary)"><span class="app-num">${a.id}</span> · ${a.vehicle} (${a.reg})</div>
                  ${passwordDisplay}
                </div>
                <div style="text-align:right">
                  <span class="badge b-${a.status.toLowerCase()}">${a.status.replace(/_/g, ' ').toLowerCase()}</span>
                  <div style="font-size:10.5px;color:var(--text-tertiary);margin-top:2px">${FinEngine.kes(a.amount)}</div>
                </div>
              </div>
            `;
          }).join('');
        }
      }
    }

    // Recent activity list — collections roles only see servicing / recovery events
    const actBox = document.getElementById('dash-recent-activity');
    if (actBox) {
      let rec = data.notifications || [];
      if (collectionsRole) {
        rec = rec.filter(n => n.role === 'COLLECTION_OFFICER' || n.role === 'COLLECTION_MANAGER' || (n.appId || '').startsWith('ACC-'));
      } else if (role === 'BRANCH_ADMIN') {
        const visibleAppIds = new Set(this.branchScopedApplications(data).map(a => a.id));
        rec = rec.filter(n => !n.appId || visibleAppIds.has(n.appId));
      }
      rec = rec.slice(0, 5);
      actBox.innerHTML = rec.map(n => {
        const isLoan = (n.appId || '').startsWith('ACC-') || collectionsRole;
        const click = isLoan
          ? `LMSModule.openLoan360('${n.appId}')`
          : `LOSModule.openApplicationDetail('${n.appId}')`;
        const relTime = this.timeAgoFromString(n.time, nowMs);
        return `
        <div style="padding:8px 0;border-bottom:1px solid var(--border-light);font-size:11.5px;cursor:pointer" 
          onclick="${click}">
          <div style="color:var(--text-tertiary);font-size:10.5px">${relTime} · ${n.role}</div>
          <div style="margin-top:2px;font-weight:500;color:var(--text-primary)">${n.message}</div>
        </div>
      `;
      }).join('') || `<div style="text-align:center;padding:1.5rem;color:var(--text-tertiary)">No recent activity.</div>`;
    }
  },

  renderCollectionsView() {
    const data = DataStore.get();
    const container = document.getElementById('collections-content');
    if (!container) return;

    if (this.cannotAccessCollections(data.activeRole)) {
      container.innerHTML = `
        <div class="card">
          <div class="card-body" style="text-align:center;padding:2.5rem;color:var(--text-tertiary)">
            <i class="ti ti-lock" style="font-size:32px;display:block;margin-bottom:8px;color:#0284C7"></i>
            Collections, arrears and statements are available after disbursement for <strong>Overall Admin</strong> and <strong>Collection &amp; Recovery</strong>.
          </div>
        </div>`;
      return;
    }

    const role = data.activeRole;
    const isOfficer = role === 'COLLECTION_OFFICER';
    const isManager = role === 'COLLECTION_MANAGER' || role === 'OVERALL_ADMIN' || role === 'SUPER_ADMIN';

    const delinquentLoans = (data.loans || []).filter(l => l.daysPastDue > 0 || l.status === 'REPOSSESSED' || l.status === 'IN_ARREARS');
    const par1_30 = delinquentLoans.filter(l => l.daysPastDue > 0 && l.daysPastDue <= 30);
    const par31_60 = delinquentLoans.filter(l => l.daysPastDue > 30 && l.daysPastDue <= 60);
    const par61_90 = delinquentLoans.filter(l => l.daysPastDue > 60 && l.daysPastDue <= 90);
    const par90plus = delinquentLoans.filter(l => l.daysPastDue > 90);
    const noticeStageLabel = (n) => ['None', 'Reminder issued', 'Statutory demand', 'Repossession'][n || 0] || 'None';

    container.innerHTML = `
      <div class="metrics-grid">
        <div class="metric-card">
          <div class="metric-top"><span class="metric-title">PAR 1–30 (Watchlist)</span><div class="metric-icon" style="background:#FEF9C3;color:#854D0E"><i class="ti ti-eye"></i></div></div>
          <div class="metric-value" style="color:#854D0E">${par1_30.length} Loans</div>
          <div class="metric-footer">${FinEngine.kes(par1_30.reduce((s, l) => s + (l.currentPrincipal || 0), 0))} at risk · Officer book</div>
        </div>
        <div class="metric-card">
          <div class="metric-top"><span class="metric-title">PAR 31–60 (Substandard)</span><div class="metric-icon" style="background:#FFEDD5;color:#C2410C"><i class="ti ti-alert-circle"></i></div></div>
          <div class="metric-value" style="color:#C2410C">${par31_60.length} Loans</div>
          <div class="metric-footer">${FinEngine.kes(par31_60.reduce((s, l) => s + (l.currentPrincipal || 0), 0))} at risk · Escalate</div>
        </div>
        <div class="metric-card">
          <div class="metric-top"><span class="metric-title">PAR 61–90 (Doubtful)</span><div class="metric-icon" style="background:#FEE2E2;color:#B91C1C"><i class="ti ti-alert-triangle"></i></div></div>
          <div class="metric-value" style="color:#B91C1C">${par61_90.length} Loans</div>
          <div class="metric-footer">${FinEngine.kes(par61_90.reduce((s, l) => s + (l.currentPrincipal || 0), 0))} at risk · Manager</div>
        </div>
        <div class="metric-card">
          <div class="metric-top"><span class="metric-title">PAR 90+ (Loss / Repossess)</span><div class="metric-icon" style="background:#7F1D1D;color:#FFF"><i class="ti ti-gavel"></i></div></div>
          <div class="metric-value" style="color:#991B1B">${par90plus.length} Loans</div>
          <div class="metric-footer">${FinEngine.kes(par90plus.reduce((s, l) => s + (l.currentPrincipal || 0), 0))} at risk · Legal</div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title-group">
            <i class="ti ti-gavel" style="font-size:16px;color:#DC2626"></i>
            <span class="card-title">Arrears & Legal Recoveries Portfolio</span>
          </div>
          <span class="badge" style="background:#FEE2E2;color:#991B1B">${delinquentLoans.length} Loans Overdue · ${data.roles[role]?.title || role}</span>
        </div>
        <div class="card-body" style="padding:0">
          <div class="table-responsive">
            <table class="tbl">
              <thead>
                <tr>
                  <th>Account No.</th>
                  <th>Customer & Phone</th>
                  <th>Vehicle / Reg</th>
                  <th>Outstanding Principal</th>
                  <th>Unpaid Penalties</th>
                  <th>DPD</th>
                  <th>Aging / Notice</th>
                  <th style="text-align:right">Recovery Action</th>
                </tr>
              </thead>
              <tbody>
                ${delinquentLoans.map(l => {
                  const par = FinEngine.classifyPAR(l.daysPastDue);
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
                      <td style="font-weight:700">${FinEngine.kes(l.currentPrincipal)}</td>
                      <td style="color:#DC2626;font-weight:600">${FinEngine.kes(l.unpaidPenalties || 0)}</td>
                      <td><span style="color:#DC2626;font-weight:700">${l.daysPastDue} Days</span></td>
                      <td>
                        <span class="badge ${par.class}">${par.label}</span>
                        <div style="font-size:10px;color:var(--text-secondary);margin-top:2px">${noticeStageLabel(l.noticeStage)}</div>
                      </td>
                      <td style="text-align:right;white-space:nowrap">
                        ${isOfficer ? `
                          <button class="btn btn-sm" onclick="LMSModule.logCollectionAction('${l.accountNumber}', 'Phone follow-up')">
                            <i class="ti ti-phone"></i> Log Call
                          </button>
                          <button class="btn btn-sm btn-accent" onclick="LMSModule.issueReminderNotice('${l.accountNumber}')" style="margin-left:4px">
                            <i class="ti ti-mail"></i> Reminder
                          </button>
                          ${l.daysPastDue > 14 ? `
                            <button class="btn btn-sm btn-danger" onclick="LMSModule.escalateToCollectionsManager('${l.accountNumber}')" style="margin-left:4px">
                              <i class="ti ti-arrow-up"></i> Escalate
                            </button>
                          ` : ''}
                        ` : ''}
                        ${isManager ? `
                          <button class="btn btn-sm btn-danger" onclick="LMSModule.showDemandNoticeModal('${l.accountNumber}')">
                            <i class="ti ti-gavel"></i> Demand Notice
                          </button>
                          ${l.daysPastDue > 30 && l.status !== 'REPOSSESSED' ? `
                            <button class="btn btn-sm" onclick="LMSModule.toggleImmobilizer('${l.accountNumber}')" style="margin-left:4px">
                              <i class="ti ti-power"></i> Immobilize
                            </button>
                          ` : ''}
                          ${l.daysPastDue > 60 && l.status !== 'REPOSSESSED' ? `
                            <button class="btn btn-sm btn-danger" onclick="LMSModule.authorizeRepossession('${l.accountNumber}')" style="margin-left:4px">
                              <i class="ti ti-truck"></i> Repossess
                            </button>
                          ` : ''}
                        ` : ''}
                        ${!isOfficer && !isManager ? `
                          <button class="btn btn-sm btn-danger" onclick="LMSModule.showDemandNoticeModal('${l.accountNumber}')">
                            <i class="ti ti-gavel"></i> Demand Notice
                          </button>
                        ` : ''}
                        <button class="btn btn-sm btn-primary" onclick="LMSModule.openLoan360('${l.accountNumber}')" style="margin-left:4px">
                          <i class="ti ti-eye"></i> View
                        </button>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  },

  observeProductEditModal() {
    if (this._productEditObserver || !document.body) return;
    const attachSection = () => {
      document.querySelectorAll('.modal-overlay.active').forEach(modal => {
        const title = modal.querySelector('.modal-title')?.textContent || '';
        if (!/edit.*(?:loan\s+)?product/i.test(title) || modal.querySelector('.product-kyc-requirements')) return;

        const data = DataStore.get();
        const controls = [...modal.querySelectorAll('input, select, textarea')];
        const product = (data.products || []).find(item => controls.some(control => {
          const value = String(control.value || '').trim();
          return value && (value === String(item.id) || value === String(item.name));
        }));
        if (!product) return;

        const defaultDocuments = [
          'National ID (front and back)',
          'KRA PIN certificate',
          'Six-month bank statement',
          'Six-month M-Pesa statement',
          'Vehicle logbook copy',
          'Vehicle valuation report'
        ];
        const selected = Array.isArray(product.kycDocuments) ? [...product.kycDocuments] : [...defaultDocuments];
        const section = document.createElement('section');
        section.className = 'product-kyc-requirements';
        section.style.cssText = 'margin-top:16px;padding:14px;border:1px solid var(--border-light);border-radius:var(--radius-md);background:var(--bg-surface-secondary)';
        section.innerHTML = `
          <div class="section-label" style="margin:0 0 4px">KYC documents</div>
          <p class="hint" style="margin:0 0 10px">Select the documents required for this loan product.</p>
          <div class="product-kyc-list" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px">
            ${[...new Set([...defaultDocuments, ...selected])].map(documentName => `
              <label style="display:flex;align-items:flex-start;gap:8px;font-size:12px">
                <input type="checkbox" data-kyc-document value="${this.escapeHtml(documentName)}" ${selected.includes(documentName) ? 'checked' : ''}>
                <span>${this.escapeHtml(documentName)}</span>
              </label>`).join('')}
          </div>
          <div style="display:flex;gap:8px;margin-top:12px">
            <input type="text" class="product-kyc-custom-input" aria-label="Custom KYC document" placeholder="Add another document requirement" style="flex:1">
            <button type="button" class="btn btn-sm product-kyc-add">Add document</button>
          </div>`;

        const form = modal.querySelector('form') || modal.querySelector('.modal-body');
        if (!form) return;
        const actions = [...form.children].reverse().find(child => child.querySelector('button[type="submit"]'));
        if (actions) form.insertBefore(section, actions);
        else form.appendChild(section);
        const saveSelection = () => {
          product.kycDocuments = [...section.querySelectorAll('[data-kyc-document]:checked')].map(input => input.value);
          DataStore.save(data);
        };
        section.addEventListener('change', event => {
          if (event.target.matches('[data-kyc-document]')) saveSelection();
        });
        section.querySelector('.product-kyc-add')?.addEventListener('click', () => {
          const input = section.querySelector('.product-kyc-custom-input');
          const documentName = input?.value.trim();
          if (!documentName) return;
          if (![...section.querySelectorAll('[data-kyc-document]')].some(item => item.value.toLowerCase() === documentName.toLowerCase())) {
            const label = document.createElement('label');
            label.style.cssText = 'display:flex;align-items:flex-start;gap:8px;font-size:12px';
            label.innerHTML = `<input type="checkbox" data-kyc-document checked value="${this.escapeHtml(documentName)}"><span>${this.escapeHtml(documentName)}</span>`;
            section.querySelector('.product-kyc-list').appendChild(label);
            saveSelection();
          }
          if (input) input.value = '';
        });
      });
    };

    this._productEditObserver = new MutationObserver(attachSection);
    this._productEditObserver.observe(document.body, { childList: true, subtree: true });
    attachSection();
  },

  renderCollateralVault() {
    const data = DataStore.get();
    const container = document.getElementById('collateral-content');
    if (!container) return;

    const vault = data.collateralVault || [];
    const releaseQueue = (data.loans || []).filter(l => l.release && l.release.status !== 'CLOSED_LOGBOOK_RELEASED');
    const releasedCount = vault.filter(v => v.status === 'RELEASED').length;

    const queueHtml = `
      <div class="metrics-grid">
        <div class="metric-card">
          <div class="metric-top"><span class="metric-title">Pending logbook release</span><div class="metric-icon" style="background:#ECFDF5;color:#059669"><i class="ti ti-lock-open"></i></div></div>
          <div class="metric-value">${releaseQueue.length}</div>
          <div class="metric-footer">Paid in full · closure queue</div>
        </div>
        <div class="metric-card">
          <div class="metric-top"><span class="metric-title">In safe custody</span><div class="metric-icon" style="background:#EFF6FF;color:#0284C7"><i class="ti ti-building-warehouse"></i></div></div>
          <div class="metric-value">${vault.filter(v => v.status === 'IN_CUSTODY').length}</div>
          <div class="metric-footer">Original logbooks held</div>
        </div>
        <div class="metric-card">
          <div class="metric-top"><span class="metric-title">Pending discharge</span><div class="metric-icon" style="background:#FEF9C3;color:#854D0E"><i class="ti ti-clock"></i></div></div>
          <div class="metric-value">${vault.filter(v => v.status === 'PENDING_DISCHARGE').length}</div>
          <div class="metric-footer">Approved / in handover</div>
        </div>
        <div class="metric-card">
          <div class="metric-top"><span class="metric-title">Logbooks released</span><div class="metric-icon" style="background:#F0FDF4;color:#047857"><i class="ti ti-circle-check"></i></div></div>
          <div class="metric-value">${releasedCount}</div>
          <div class="metric-footer">CLOSED → released</div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title-group">
            <i class="ti ti-lock-open" style="font-size:18px;color:#059669"></i>
            <span class="card-title">Automated Logbook Release Queue</span>
          </div>
          <span class="badge" style="background:#ECFDF5;color:#047857">${releaseQueue.length} in workflow</span>
        </div>
        <div class="card-body" style="padding:0">
          ${!releaseQueue.length ? `
            <div style="text-align:center;padding:1.5rem;color:var(--text-tertiary)">No paid-in-full accounts awaiting logbook release.</div>
          ` : `
            <div class="table-responsive">
              <table class="tbl">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Customer</th>
                    <th>Vehicle / Logbook</th>
                    <th>Final receipt</th>
                    <th>Workflow step</th>
                    <th>Status</th>
                    <th style="text-align:right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  ${releaseQueue.map(l => {
                    const step = FinEngine.RELEASE_STEPS[(l.release.stage || 1) - 1];
                    return `
                      <tr>
                        <td><span class="app-num">${l.accountNumber}</span></td>
                        <td>
                          <div style="font-weight:600">${l.customer}</div>
                          <div style="font-size:11px;color:var(--text-secondary)">${l.phone}</div>
                        </td>
                        <td>
                          <div>${l.vehicle}</div>
                          <div style="font-size:11px;font-family:var(--font-mono);color:var(--text-secondary)">${l.reg}</div>
                        </td>
                        <td style="font-size:11.5px">${l.release.reconciliation?.receiptNo || '—'}</td>
                        <td>${l.release.stage}. ${step?.short || ''}</td>
                        <td><span class="badge b-${l.release.status.toLowerCase()}">${l.release.status.replace(/_/g, ' ').toLowerCase()}</span></td>
                        <td style="text-align:right">
                          <button class="btn btn-sm btn-success" onclick="LMSModule.openReleaseWorkflow('${l.accountNumber}')">
                            <i class="ti ti-arrow-right"></i> Continue release
                          </button>
                        </td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          `}
        </div>
      </div>
    `;

    container.innerHTML = `
      ${queueHtml}
      <div class="card">
        <div class="card-header">
          <div class="card-title-group">
            <i class="ti ti-building-warehouse" style="font-size:18px;color:#0284C7"></i>
            <span class="card-title">Spectrum Central Safe Vault Custody Register</span>
          </div>
          <span style="font-size:11px;color:var(--text-secondary)">Dual-Custodian Safe Protocol Active</span>
        </div>
        <div class="card-body" style="padding:0">
          <div class="table-responsive">
            <table class="tbl">
              <thead>
                <tr>
                  <th>Vault Ref & Safe Box</th>
                  <th>Vehicle Reg / Logbook #</th>
                  <th>Registered Owner</th>
                  <th>NTSA Caveat Ref</th>
                  <th>Date Deposited</th>
                  <th>Custodian</th>
                  <th>GPS Telematics</th>
                  <th>Custody Status</th>
                  <th style="text-align:right">Vault Action</th>
                </tr>
              </thead>
              <tbody>
                ${vault.map(v => `
                  <tr>
                    <td>
                      <span class="app-num">${v.vaultId}</span>
                      <div style="font-size:10.5px;color:var(--text-secondary)">${v.location}</div>
                    </td>
                    <td>
                      <div style="font-weight:700">${v.regNumber}</div>
                      <div style="font-size:10.5px;color:var(--text-tertiary);font-family:var(--font-mono)">${v.logbookNumber}</div>
                    </td>
                    <td>${v.ownerName}</td>
                    <td style="font-family:var(--font-mono);font-size:11px;color:#0284C7">${v.ntsaCaveatRef}</td>
                    <td>${v.dateDeposited}</td>
                    <td>${v.custodian}</td>
                    <td>
                      ${v.gpsDetails ? `
                        <div style="font-size:11px;font-weight:600;color:#059669">
                          <i class="ti ti-gps"></i> ${v.gpsDetails.engineStatus} (${v.gpsDetails.batteryPct}%)
                        </div>
                        <div style="font-size:10px;color:var(--text-secondary)">${v.gpsDetails.currentLocation}</div>
                      ` : '<span style="color:var(--text-tertiary)">No Tracker</span>'}
                    </td>
                    <td>
                      <span class="badge ${v.status === 'IN_CUSTODY' ? 'b-active' : v.status === 'RELEASED' ? 'b-logbook_released' : v.status === 'PENDING_DISCHARGE' ? 'b-pending_discharge' : 'b-rejected'}">
                        ${v.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td style="text-align:right">
                      ${v.status === 'RELEASED' ? '<span style="font-size:11px;color:#059669;font-weight:600">LOGBOOK RELEASED</span>' : `
                        <button class="btn btn-sm btn-accent" onclick="LMSModule.releaseLogbookDualCustody('${v.vaultId}')">
                          <i class="ti ti-lock-open"></i> ${v.status === 'PENDING_DISCHARGE' ? 'Continue Release' : 'Discharge & Release'}
                        </button>
                      `}
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  },

  renderAnalytics() {
    const data = DataStore.get();
    const container = document.getElementById('analytics-content');
    if (!container) return;

    if (this.cannotAccessAnalytics(data.activeRole)) {
      container.innerHTML = `
        <div class="card">
          <div class="card-body" style="text-align:center;padding:2.5rem;color:var(--text-tertiary)">
            <i class="ti ti-lock" style="font-size:32px;display:block;margin-bottom:8px;color:#0284C7"></i>
            Analytics &amp; PAR is not available for <strong>${data.roles[data.activeRole]?.title || data.activeRole}</strong>.
          </div>
        </div>`;
      return;
    }

    const totalPortfolio = (data.loans || []).reduce((s, l) => s + l.currentPrincipal, 0);
    const totalDisbursed = (data.loans || []).reduce((s, l) => s + l.disbursedAmount, 0);
    const parTotal = (data.loans || []).filter(l => l.daysPastDue > 0).reduce((s, l) => s + l.currentPrincipal, 0);
    const parRatio = totalPortfolio > 0 ? ((parTotal / totalPortfolio) * 100).toFixed(1) : 0;

    container.innerHTML = `
      <div class="metrics-grid">
        <div class="metric-card">
          <div class="metric-top"><span class="metric-title">Gross Loan Book</span><div class="metric-icon" style="background:#EFF6FF;color:#0284C7"><i class="ti ti-coins"></i></div></div>
          <div class="metric-value">${FinEngine.kes(totalPortfolio)}</div>
          <div class="metric-footer positive">Active live servicing</div>
        </div>
        <div class="metric-card">
          <div class="metric-top"><span class="metric-title">Portfolio At Risk (PAR %)</span><div class="metric-icon" style="background:#FEF2F2;color:#DC2626"><i class="ti ti-percentage"></i></div></div>
          <div class="metric-value" style="color:${parRatio > 5 ? '#DC2626' : '#059669'}">${parRatio}%</div>
          <div class="metric-footer negative">${FinEngine.kes(parTotal)} past due</div>
        </div>
        <div class="metric-card">
          <div class="metric-top"><span class="metric-title">Total Capital Deployed</span><div class="metric-icon" style="background:#ECFDF5;color:#059669"><i class="ti ti-trending-up"></i></div></div>
          <div class="metric-value">${FinEngine.kes(totalDisbursed)}</div>
          <div class="metric-footer positive">Cumulative loans</div>
        </div>
        <div class="metric-card">
          <div class="metric-top"><span class="metric-title">Average Loan Ticket</span><div class="metric-icon" style="background:#FAF5FF;color:#7C3AED"><i class="ti ti-ticket"></i></div></div>
          <div class="metric-value">${FinEngine.kes(Math.round(totalDisbursed / Math.max(1, (data.loans || []).length)))}</div>
          <div class="metric-footer">Logbook collateralized</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div class="card">
          <div class="card-header"><span class="card-title">Portfolio Delinquency & Aging (PAR)</span></div>
          <div class="card-body" style="height:260px;display:flex;align-items:center;justify-content:center">
            <canvas id="chart-par" style="max-height:240px"></canvas>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">Origination Pipeline Stages</span></div>
          <div class="card-body" style="height:260px;display:flex;align-items:center;justify-content:center">
            <canvas id="chart-pipeline" style="max-height:240px"></canvas>
          </div>
        </div>
      </div>
    `;

    // Render Charts with Chart.js if loaded
    setTimeout(() => {
      this.initAnalyticsCharts(data);
    }, 100);
  },

  initAnalyticsCharts(data) {
    if (typeof Chart === 'undefined') return;

    // 1. PAR Aging Doughnut
    const ctxPar = document.getElementById('chart-par')?.getContext('2d');
    if (ctxPar) {
      if (this.charts.par) this.charts.par.destroy();
      const performing = (data.loans || []).filter(l => l.daysPastDue === 0).length;
      const watchlist = (data.loans || []).filter(l => l.daysPastDue > 0 && l.daysPastDue <= 30).length;
      const substandard = (data.loans || []).filter(l => l.daysPastDue > 30 && l.daysPastDue <= 60).length;
      const loss = (data.loans || []).filter(l => l.daysPastDue > 60).length;

      this.charts.par = new Chart(ctxPar, {
        type: 'doughnut',
        data: {
          labels: ['Current (PAR 0)', 'Watchlist (1-30 DPD)', 'Substandard (31-60 DPD)', 'Loss / NPL (60+ DPD)'],
          datasets: [{
            data: [performing, watchlist, substandard, loss],
            backgroundColor: ['#059669', '#EAB308', '#F97316', '#DC2626']
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 10 } } } }
        }
      });
    }

    // 2. Pipeline Bar Chart
    const ctxPipe = document.getElementById('chart-pipeline')?.getContext('2d');
    if (ctxPipe) {
      if (this.charts.pipeline) this.charts.pipeline.destroy();
      // Disbursed facilities are no longer part of the LOS origination pipeline.
      const losApplications = (data.applications || []).filter(a => a.status !== 'DISBURSED');
      const stages = ['Submitted', 'Risk Review', 'Pending Approval', 'Conditions', 'Loan Booking'];
      const counts = [
        losApplications.filter(a => a.status === 'SUBMITTED').length,
        losApplications.filter(a => a.status === 'RISK_REVIEW').length,
        losApplications.filter(a => a.status === 'PENDING_APPROVAL').length,
        losApplications.filter(a => a.status.startsWith('CONDITIONS')).length,
        losApplications.filter(a => a.status === 'LOAN_BOOKING' || a.status === 'FINAL_APPROVED').length
      ];

      this.charts.pipeline = new Chart(ctxPipe, {
        type: 'bar',
        data: {
          labels: stages,
          datasets: [{
            label: 'Volume of Applications',
            data: counts,
            backgroundColor: '#0284C7',
            borderRadius: 4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
        }
      });
    }
  },

  renderBranches() {
    const data = DataStore.get();
    const container = document.getElementById('branches-content');
    if (!container) return;

    if (!this.canManageBranches(data.activeRole)) {
      container.innerHTML = `<div class="card"><div class="card-body" style="text-align:center;padding:2.5rem;color:var(--text-tertiary)"><i class="ti ti-lock" style="font-size:32px;display:block;margin-bottom:8px;color:#0284C7"></i>Branch Management is restricted to Overall Admin and Super Admin.</div></div>`;
      return;
    }

    const branches = data.branches || [];
    const active = branches.filter(b => b.status === 'ACTIVE').length;
    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.25rem;gap:12px;flex-wrap:wrap">
        <div>
          <div style="font-size:18px;font-weight:700;color:var(--brand-primary)">Branch Management</div>
          <div style="font-size:12px;color:var(--text-secondary)">Manage registered operating locations and branch contacts.</div>
        </div>
        <button class="btn btn-primary" onclick="App.openBranchModal()">
          <i class="ti ti-plus"></i> Add Branch
        </button>
      </div>

      <div class="metrics-grid">
        <div class="metric-card"><div class="metric-top"><span class="metric-title">Total branches</span><div class="metric-icon" style="background:#EFF6FF;color:#0284C7"><i class="ti ti-building-community"></i></div></div><div class="metric-value">${branches.length}</div><div class="metric-footer">Registered operating locations</div></div>
        <div class="metric-card"><div class="metric-top"><span class="metric-title">Active branches</span><div class="metric-icon" style="background:#ECFDF5;color:#059669"><i class="ti ti-circle-check"></i></div></div><div class="metric-value">${active}</div><div class="metric-footer">Currently open for operations</div></div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title-group"><i class="ti ti-building-community" style="font-size:18px;color:#0284C7"></i><span class="card-title">Branch Management</span></div><span class="badge" style="background:#EFF6FF;color:#0284C7">Admin controlled</span></div>
        <div class="card-body" style="padding:0"><div class="table-responsive"><table class="tbl"><thead><tr><th>Branch</th><th>Code</th><th>Location</th><th>Phone</th><th>Branch Manager</th><th>Status</th></tr></thead><tbody>
          ${branches.map(b => `<tr><td><strong>${b.name}</strong><div style="font-size:11px;color:var(--text-secondary)">${b.id}</div></td><td><span class="app-num">${b.code}</span></td><td>${b.location}</td><td>${b.phone}</td><td>${b.manager}</td><td><span class="badge ${b.status === 'ACTIVE' ? 'b-active' : 'b-settled'}">${b.status}</span></td></tr>`).join('') || '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text-tertiary)">No branches configured.</td></tr>'}
        </tbody></table></div></div>
      </div>`;
  },

  openBranchModal() {
    const data = DataStore.get();
    if (!this.canManageBranches(data.activeRole)) {
      alert('Only Overall Admin and Super Admin can add branches.');
      return;
    }
    const modal = document.getElementById('branch-modal');
    const form = document.getElementById('branch-form');
    if (!modal || !form) return;
    form.reset();
    document.getElementById('branch-status').value = 'ACTIVE';
    modal.classList.add('active');
    document.getElementById('branch-name')?.focus();
  },

  closeBranchModal() {
    document.getElementById('branch-modal')?.classList.remove('active');
  },

  saveBranch(evt) {
    if (evt) evt.preventDefault();
    const data = DataStore.get();
    if (!this.canManageBranches(data.activeRole)) {
      alert('Only Overall Admin and Super Admin can add branches.');
      return;
    }

    const name = (document.getElementById('branch-name')?.value || '').trim();
    const code = (document.getElementById('branch-code')?.value || '').trim().toUpperCase();
    const location = (document.getElementById('branch-location')?.value || '').trim();
    const phone = (document.getElementById('branch-phone')?.value || '').trim();
    const manager = (document.getElementById('branch-manager')?.value || '').trim();
    const status = document.getElementById('branch-status')?.value || 'ACTIVE';

    if (!name || !code || !location || !phone || !manager) {
      alert('Complete all branch details before saving.');
      return;
    }
    data.branches = Array.isArray(data.branches) ? data.branches : [];
    if (data.branches.some(b => String(b.code || '').toUpperCase() === code)) {
      alert(`Branch code ${code} is already in use.`);
      return;
    }

    const nextNumber = data.branches.reduce((max, b) => {
      const match = String(b.id || '').match(/(\\d+)$/);
      return Math.max(max, match ? parseInt(match[1], 10) : 0);
    }, 0) + 1;

    data.branches.push({
      id: `BR-${String(nextNumber).padStart(3, '0')}`,
      name, code, location, phone, manager, status
    });
    DataStore.save(data);
    this.closeBranchModal();
    this.renderBranches();
  },

  renderStaff() {
    const data = DataStore.get();
    const container = document.getElementById('staff-content');
    if (!container) return;
    if (!this.canManageStaff(data.activeRole)) {
      container.innerHTML = `<div class="card"><div class="card-body" style="text-align:center;padding:2.5rem;color:var(--text-tertiary)"><i class="ti ti-lock" style="font-size:32px;display:block;margin-bottom:8px;color:#0284C7"></i>Staff Management is restricted to Overall Admin and Super Admin.</div></div>`;
      return;
    }
    const staff = data.staff || [];
    const branchName = id => (data.branches || []).find(b => b.id === id)?.name || id || '—';
    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.25rem;gap:12px;flex-wrap:wrap">
        <div><div style="font-size:18px;font-weight:700;color:var(--brand-primary)">Staff Management</div><div style="font-size:12px;color:var(--text-secondary)">Manage staff profiles, roles, branch assignments and access status.</div></div>
        <button class="btn btn-primary" onclick="App.openStaffModal()"><i class="ti ti-user-plus"></i> Add Staff</button>
      </div>
      <div class="metrics-grid">
        <div class="metric-card"><div class="metric-top"><span class="metric-title">Total staff</span><div class="metric-icon" style="background:#EFF6FF;color:#0284C7"><i class="ti ti-users"></i></div></div><div class="metric-value">${staff.length}</div><div class="metric-footer">Registered system users</div></div>
        <div class="metric-card"><div class="metric-top"><span class="metric-title">Active staff</span><div class="metric-icon" style="background:#ECFDF5;color:#059669"><i class="ti ti-user-check"></i></div></div><div class="metric-value">${staff.filter(s => s.status === 'ACTIVE').length}</div><div class="metric-footer">Currently enabled</div></div>
      </div>
              <div class="card"><div class="card-header"><div class="card-title-group"><i class="ti ti-users" style="font-size:18px;color:#0284C7"></i><span class="card-title">Staff Register</span></div><span class="badge" style="background:#EFF6FF;color:#0284C7">Admin controlled</span></div><div class="card-body" style="padding:0"><div class="table-responsive"><table class="tbl"><thead><tr><th>Staff</th><th>Gender</th><th>Contact</th><th>Role</th><th>Branch</th><th>Status</th><th style="text-align:right">Action</th></tr></thead><tbody>${staff.map(s => `<tr><td><strong>${this.escapeHtml(s.name || '')}</strong><div style="font-size:11px;color:var(--text-secondary)">${this.escapeHtml(s.id)}</div></td><td>${this.escapeHtml(String(s.gender || '—').replace(/_/g, ' '))}</td><td>${this.escapeHtml(s.email || '')}<div style="font-size:11px;color:var(--text-secondary)">${this.escapeHtml(s.phone || '')}</div></td><td>${this.escapeHtml(data.roles[s.role]?.title || s.role)}</td><td>${this.escapeHtml(branchName(s.branch))}</td><td><span class="badge ${s.status === 'ACTIVE' ? 'b-active' : 'b-settled'}">${this.escapeHtml(s.status || '')}</span></td><td style="text-align:right"><button class="btn btn-sm btn-danger" onclick="App.deleteStaff('${this.escapeHtml(s.id)}')"><i class="ti ti-trash"></i> Delete</button></td></tr>`).join('') || '<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--text-tertiary)">No staff configured.</td></tr>'}</tbody></table></div></div></div>`;
  },

  deleteStaff(staffId) {
    const data = DataStore.get();
    if (!this.canManageStaff(data.activeRole)) {
      alert('Only Overall Admin and Super Admin can delete staff users.');
      return;
    }
    const staff = (data.staff || []).find(item => item.id === staffId);
    if (!staff) return;
    if (!confirm(`Delete user ${staff.name} (${staff.email})? This action will be recorded in the audit log.`)) return;
    data.staff = data.staff.filter(item => item.id !== staffId);
    DataStore.save(data);
    this.renderStaff();
    this.renderAuditLog();
  },

  openStaffModal() {
    const data = DataStore.get();
    if (!this.canManageStaff(data.activeRole)) { alert('Only Overall Admin and Super Admin can manage staff.'); return; }
    const form = document.getElementById('staff-form');
    if (!form) return;
    form.reset();
    const role = document.getElementById('staff-role');
    const branch = document.getElementById('staff-branch');
    role.innerHTML = Object.keys(data.roles).map(k => `<option value="${k}">${data.roles[k].title}</option>`).join('');
    branch.innerHTML = (data.branches || []).map(b => `<option value="${b.id}">${b.name}</option>`).join('');
    document.getElementById('staff-status').value = 'ACTIVE';
    document.getElementById('staff-modal')?.classList.add('active');
    document.getElementById('staff-name')?.focus();
  },

  closeStaffModal() { document.getElementById('staff-modal')?.classList.remove('active'); },

  saveStaff(evt) {
    if (evt) evt.preventDefault();
    const data = DataStore.get();
    if (!this.canManageStaff(data.activeRole)) { alert('Only Overall Admin and Super Admin can manage staff.'); return; }
    const name = (document.getElementById('staff-name')?.value || '').trim();
    const email = (document.getElementById('staff-email')?.value || '').trim().toLowerCase();
    const phone = (document.getElementById('staff-phone')?.value || '').trim();
    const gender = document.getElementById('staff-gender')?.value || '';
    const role = document.getElementById('staff-role')?.value || '';
    const branch = document.getElementById('staff-branch')?.value || '';
    const status = document.getElementById('staff-status')?.value || 'ACTIVE';
    if (!name || !email || !phone || !gender || !role || !branch) { alert('Complete all staff details before saving.'); return; }
    data.staff = Array.isArray(data.staff) ? data.staff : [];
    if (data.staff.some(s => String(s.email).toLowerCase() === email)) { alert('A staff member with this email already exists.'); return; }
    const next = data.staff.reduce((max, s) => Math.max(max, parseInt(String(s.id || '').replace(/\\D/g, ''), 10) || 0), 0) + 1;
    data.staff.push({ id: `ST-${String(next).padStart(3, '0')}`, name, email, phone, gender, role, branch, status });
    DataStore.save(data);
    this.closeStaffModal();
    this.renderStaff();
  },

  renderEmailNotificationConfiguration() {
    const data = DataStore.get();
    const container = document.getElementById('system-config-content');
    if (!container || !this.canManageSystemConfiguration(data.activeRole)) return;

    const email = data.systemConfig?.emailNotifications || {};
    const notifications = email.notifications || {};
    const pipelines = email.pipelines || {};
    const alerts = email.alerts || {};
    container.insertAdjacentHTML('beforeend', `
      <div class="card" style="margin-top:14px">
        <div class="card-header"><div class="card-title-group"><i class="ti ti-mail" style="font-size:18px;color:#0284C7"></i><span class="card-title">Email &amp; Notifications</span></div><span class="badge" style="background:#EFF6FF;color:#0284C7">Super Admin only</span></div>
        <div class="card-body">
          <form onsubmit="App.saveEmailNotificationConfiguration(event)" autocomplete="off">
            <div class="section-label" style="margin-top:0">Email delivery</div>
            <div class="form-grid">
              <div class="fg"><label for="email-enabled">Email notifications</label><select id="email-enabled"><option value="ENABLED" ${email.enabled !== false ? 'selected' : ''}>Enabled</option><option value="DISABLED" ${email.enabled === false ? 'selected' : ''}>Disabled</option></select></div>
              <div class="fg"><label for="email-provider">Delivery provider</label><select id="email-provider"><option value="SMTP" ${(email.provider || 'SMTP') === 'SMTP' ? 'selected' : ''}>SMTP</option><option value="SENDGRID" ${email.provider === 'SENDGRID' ? 'selected' : ''}>SendGrid</option><option value="AWS_SES" ${email.provider === 'AWS_SES' ? 'selected' : ''}>Amazon SES</option></select></div>
              <div class="fg"><label for="email-sender-name">Sender name</label><input id="email-sender-name" value="${email.senderName || 'Spectrum Credit'}" required></div>
              <div class="fg"><label for="email-sender-address">Sender email</label><input id="email-sender-address" type="email" value="${email.senderAddress || ''}" placeholder="notifications@example.com" required></div>
              <div class="fg"><label for="email-smtp-host">SMTP host</label><input id="email-smtp-host" value="${email.smtpHost || ''}" placeholder="smtp.example.com"></div>
              <div class="fg"><label for="email-smtp-port">SMTP port</label><input id="email-smtp-port" type="number" min="1" max="65535" value="${Number(email.smtpPort) || 587}"></div>
            </div>
            <div class="section-label">Notification events</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;margin-bottom:14px">
              <label><input type="checkbox" id="notify-applications" ${notifications.applications !== false ? 'checked' : ''}> Application and workflow updates</label>
              <label><input type="checkbox" id="notify-repayments" ${notifications.repayments !== false ? 'checked' : ''}> Repayment and receipt alerts</label>
              <label><input type="checkbox" id="notify-arrears" ${notifications.arrears !== false ? 'checked' : ''}> Arrears and collections alerts</label>
              <label><input type="checkbox" id="notify-security" ${notifications.security !== false ? 'checked' : ''}> Security and audit alerts</label>
            </div>

            <div class="section-label">Mailing pipelines &amp; alerts</div>
            <div class="form-grid">
              <div class="fg"><label for="pipeline-application">Application pipeline</label><select id="pipeline-application"><option value="ENABLED" ${pipelines.application !== false ? 'selected' : ''}>Enabled</option><option value="DISABLED" ${pipelines.application === false ? 'selected' : ''}>Disabled</option></select><small style="color:var(--text-secondary)">Workflow status, approval and condition updates.</small></div>
              <div class="fg"><label for="pipeline-repayment">Repayment pipeline</label><select id="pipeline-repayment"><option value="ENABLED" ${pipelines.repayment !== false ? 'selected' : ''}>Enabled</option><option value="DISABLED" ${pipelines.repayment === false ? 'selected' : ''}>Disabled</option></select><small style="color:var(--text-secondary)">Receipts, due dates and payment confirmations.</small></div>
              <div class="fg"><label for="pipeline-collections">Collections pipeline</label><select id="pipeline-collections"><option value="ENABLED" ${pipelines.collections !== false ? 'selected' : ''}>Enabled</option><option value="DISABLED" ${pipelines.collections === false ? 'selected' : ''}>Disabled</option></select><small style="color:var(--text-secondary)">Arrears, demand notices and recovery actions.</small></div>
              <div class="fg"><label for="pipeline-security">Security pipeline</label><select id="pipeline-security"><option value="ENABLED" ${pipelines.security !== false ? 'selected' : ''}>Enabled</option><option value="DISABLED" ${pipelines.security === false ? 'selected' : ''}>Disabled</option></select><small style="color:var(--text-secondary)">Login, access control and audit alerts.</small></div>
              <div class="fg"><label for="alert-channel">Alert delivery channel</label><select id="alert-channel"><option value="EMAIL" ${(alerts.channel || 'EMAIL') === 'EMAIL' ? 'selected' : ''}>Email only</option><option value="EMAIL_AND_IN_APP" ${alerts.channel === 'EMAIL_AND_IN_APP' ? 'selected' : ''}>Email and in-app</option><option value="IN_APP" ${alerts.channel === 'IN_APP' ? 'selected' : ''}>In-app only</option></select></div>
              <div class="fg"><label for="alert-failure">Delivery failure alerts</label><select id="alert-failure"><option value="ENABLED" ${alerts.deliveryFailure !== false ? 'selected' : ''}>Enabled</option><option value="DISABLED" ${alerts.deliveryFailure === false ? 'selected' : ''}>Disabled</option></select><small style="color:var(--text-secondary)">Notify administrators when email delivery fails.</small></div>
            </div>
            <div class="fg" style="max-width:360px"><label for="email-digest">Digest frequency</label><select id="email-digest"><option value="IMMEDIATE" ${(email.digestFrequency || 'IMMEDIATE') === 'IMMEDIATE' ? 'selected' : ''}>Immediate</option><option value="DAILY" ${email.digestFrequency === 'DAILY' ? 'selected' : ''}>Daily</option><option value="WEEKLY" ${email.digestFrequency === 'WEEKLY' ? 'selected' : ''}>Weekly</option><option value="DISABLED" ${email.digestFrequency === 'DISABLED' ? 'selected' : ''}>Disabled</option></select></div>
            <div style="display:flex;justify-content:flex-end;margin-top:1.25rem"><button type="submit" class="btn btn-primary"><i class="ti ti-device-floppy"></i> Save email settings</button></div>
          </form>
        </div>
      </div>`);
  },

  saveEmailNotificationConfiguration(evt) {
    if (evt) evt.preventDefault();
    const data = DataStore.get();
    if (!this.canManageSystemConfiguration(data.activeRole)) { alert('Only Super Admin can update email and notification settings.'); return; }
    const senderAddress = (document.getElementById('email-sender-address')?.value || '').trim();
    const smtpPort = Number(document.getElementById('email-smtp-port')?.value);
    if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(senderAddress)) { alert('Enter a valid sender email address.'); return; }
    if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) { alert('SMTP port must be between 1 and 65535.'); return; }
    data.systemConfig = data.systemConfig || {};
    data.systemConfig.emailNotifications = {
      enabled: document.getElementById('email-enabled')?.value === 'ENABLED',
      provider: document.getElementById('email-provider')?.value || 'SMTP',
      senderName: (document.getElementById('email-sender-name')?.value || '').trim(),
      senderAddress,
      smtpHost: (document.getElementById('email-smtp-host')?.value || '').trim(),
      smtpPort,
      digestFrequency: document.getElementById('email-digest')?.value || 'IMMEDIATE',
      notifications: {
        applications: !!document.getElementById('notify-applications')?.checked,
        repayments: !!document.getElementById('notify-repayments')?.checked,
        arrears: !!document.getElementById('notify-arrears')?.checked,
        security: !!document.getElementById('notify-security')?.checked
      },
      pipelines: {
        application: document.getElementById('pipeline-application')?.value === 'ENABLED',
        repayment: document.getElementById('pipeline-repayment')?.value === 'ENABLED',
        collections: document.getElementById('pipeline-collections')?.value === 'ENABLED',
        security: document.getElementById('pipeline-security')?.value === 'ENABLED'
      },
      alerts: {
        channel: document.getElementById('alert-channel')?.value || 'EMAIL',
        deliveryFailure: document.getElementById('alert-failure')?.value === 'ENABLED'
      }
    };
    DataStore.save(data);
    alert('Email and notification settings saved successfully.');
  },

  renderSystemConfiguration() {
    const data = DataStore.get();
    const container = document.getElementById('system-config-content');
    if (!container) return;

    if (!this.canManageSystemConfiguration(data.activeRole)) {
      container.innerHTML = `<div class="card"><div class="card-body" style="text-align:center;padding:2.5rem;color:var(--text-tertiary)"><i class="ti ti-lock" style="font-size:32px;display:block;margin-bottom:8px;color:#0284C7"></i>System Configuration is restricted to Super Admin.</div></div>`;
      return;
    }

    const config = data.systemConfig || {};
    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.25rem;gap:12px;flex-wrap:wrap">
        <div>
          <div style="font-size:18px;font-weight:700;color:var(--brand-primary)">System Configuration</div>
          <div style="font-size:12px;color:var(--text-secondary)">Super Admin controls for core platform settings and operational defaults.</div>
        </div>
        <span class="badge" style="background:#FEF3C7;color:#92400E"><i class="ti ti-shield-lock"></i> Super Admin only</span>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title-group"><i class="ti ti-settings" style="font-size:18px;color:#0284C7"></i><span class="card-title">Core system settings</span></div></div>
        <div class="card-body">
          <form id="system-config-form" onsubmit="App.saveSystemConfiguration(event)">
            <div class="form-grid">
              <div class="fg"><label for="config-org-name">Organisation name</label><input id="config-org-name" value="${config.orgName || 'Spectrum Credit Limited'}" required></div>
              <div class="fg"><label for="config-currency">Default currency</label><select id="config-currency"><option value="KES" ${config.currency === 'KES' || !config.currency ? 'selected' : ''}>KES — Kenyan Shilling</option><option value="USD" ${config.currency === 'USD' ? 'selected' : ''}>USD — US Dollar</option></select></div>
              <div class="fg"><label for="config-timezone">System timezone</label><select id="config-timezone"><option value="Africa/Nairobi" ${config.timezone === 'Africa/Nairobi' || !config.timezone ? 'selected' : ''}>Africa/Nairobi (EAT)</option><option value="UTC" ${config.timezone === 'UTC' ? 'selected' : ''}>UTC</option></select></div>
              <div class="fg"><label for="config-session">Session timeout (minutes)</label><input id="config-session" type="number" min="5" max="480" value="${config.sessionTimeout || 30}" required></div>
            </div>

            <div class="section-label">Database connection</div>
            <div class="alert alert-info" style="margin-top:0">
              <i class="ti ti-database"></i>
              <span>These settings are stored locally for this browser demo. They do not create a live database connection.</span>
            </div>
            <div class="form-grid">
              <div class="fg"><label for="config-db-engine">Database engine</label><select id="config-db-engine"><option value="LOCAL_STORAGE" ${config.database?.engine === 'LOCAL_STORAGE' || !config.database?.engine ? 'selected' : ''}>Browser Local Storage</option><option value="POSTGRESQL" ${config.database?.engine === 'POSTGRESQL' ? 'selected' : ''}>PostgreSQL</option><option value="MYSQL" ${config.database?.engine === 'MYSQL' ? 'selected' : ''}>MySQL</option></select></div>
              <div class="fg"><label for="config-db-name">Database name</label><input id="config-db-name" value="${config.database?.name || 'spectrum_lms'}" required></div>
              <div class="fg"><label for="config-db-host">Host</label><input id="config-db-host" value="${config.database?.host || 'localhost'}" required></div>
              <div class="fg"><label for="config-db-port">Port</label><input id="config-db-port" type="number" min="1" max="65535" value="${config.database?.port || 5432}" required></div>
              <div class="fg"><label for="config-db-user">Username</label><input id="config-db-user" value="${config.database?.username || 'spectrum_admin'}" required></div>
              <div class="fg"><label for="config-db-ssl">SSL mode</label><select id="config-db-ssl"><option value="DISABLED" ${config.database?.ssl === 'DISABLED' || !config.database?.ssl ? 'selected' : ''}>Disabled</option><option value="REQUIRED" ${config.database?.ssl === 'REQUIRED' ? 'selected' : ''}>Required</option></select></div>
            </div>
            <div class="section-label">Security</div>
            <div class="alert alert-info" style="margin-top:0">
              <i class="ti ti-shield-lock"></i>
              <span>These settings are enforced by the backend for API requests, including session timeout and IP whitelist access control.</span>
            </div>
            <div class="form-grid">
              <div class="fg"><label for="config-password-min">Minimum password length</label><input id="config-password-min" type="number" min="8" max="32" value="${config.security?.minPasswordLength || 8}" required></div>
              <div class="fg"><label for="config-password-expiry">Password expiry (days)</label><input id="config-password-expiry" type="number" min="0" max="365" value="${config.security?.passwordExpiryDays ?? 90}" required><small style="color:var(--text-secondary)">Use 0 to disable expiry.</small></div>
              <div class="fg"><label for="config-login-attempts">Maximum login attempts</label><input id="config-login-attempts" type="number" min="3" max="10" value="${config.security?.maxLoginAttempts || 5}" required></div>
              <div class="fg"><label for="config-lockout">Account lockout duration (minutes)</label><input id="config-lockout" type="number" min="1" max="1440" value="${config.security?.lockoutMinutes || 15}" required></div>
              <div class="fg"><label for="config-mfa">Multi-factor authentication</label><select id="config-mfa"><option value="OPTIONAL" ${config.security?.mfa === 'OPTIONAL' || !config.security?.mfa ? 'selected' : ''}>Optional</option><option value="REQUIRED" ${config.security?.mfa === 'REQUIRED' ? 'selected' : ''}>Required for all users</option></select></div>
              <div class="fg"><label for="config-audit">Audit logging</label><select id="config-audit"><option value="ENABLED" ${config.security?.auditLogging !== 'DISABLED' ? 'selected' : ''}>Enabled</option><option value="DISABLED" ${config.security?.auditLogging === 'DISABLED' ? 'selected' : ''}>Disabled</option></select></div>
              <div class="fg" style="grid-column:1 / -1"><label for="config-ip-whitelist">IP whitelisting — range access control list</label><textarea id="config-ip-whitelist" rows="4" placeholder="Example: 192.168.1.10, 10.0.0.0/24">${(config.security?.ipWhitelist || []).join('\n')}</textarea><small style="color:var(--text-secondary)">Enter one IPv4 address or CIDR range per line. Leave empty to allow access from any IP.</small></div>
            </div>
            <div style="display:flex;justify-content:flex-end;margin-top:1.25rem"><button type="submit" class="btn btn-primary"><i class="ti ti-device-floppy"></i> Save configuration</button></div>
          </form>
        </div>
      </div>`;
    this.renderAuditLog('system-config-content');
  },

  renderAuditLog(targetId = 'audit-log-content') {
    const data = DataStore.get();
    const container = document.getElementById(targetId);
    if (!container) return;
    if (!this.canManageSystemConfiguration(data.activeRole)) {
      container.innerHTML = '<div class="alert alert-info"><i class="ti ti-lock"></i><span>Only Super Admin can view the system audit log.</span></div>';
      return;
    }

    const entries = Array.isArray(data.auditLog) ? data.auditLog : [];
    const rows = entries.map(entry => {
      const parsed = new Date(entry.at);
      const timestamp = Number.isNaN(parsed.getTime()) ? entry.at || '—' : parsed.toLocaleString();
      return `<tr>
        <td style="white-space:nowrap">${this.escapeHtml(timestamp)}</td>
        <td><strong>${this.escapeHtml(entry.action || 'Activity')}</strong><div style="font-size:10px;color:var(--text-secondary)">${this.escapeHtml(entry.entityType || '')}</div></td>
        <td><span class="app-num">${this.escapeHtml(entry.entityId || '—')}</span></td>
        <td>${this.escapeHtml(entry.details || '—')}</td>
        <td>${this.escapeHtml(entry.by || entry.role || 'System')}<div style="font-size:10px;color:var(--text-secondary)">${this.escapeHtml(entry.role || '')}</div></td>
      </tr>`;
    }).join('');

    const html = `
      <div class="card" style="margin-top:14px">
        <div class="card-header">
          <div class="card-title-group"><i class="ti ti-history" style="font-size:18px;color:#0284C7"></i><span class="card-title">System Audit Log</span></div>
          <span class="badge" style="background:#EFF6FF;color:#0284C7">${entries.length} events</span>
        </div>
        <div class="card-body" style="padding:0">
          <div class="table-responsive">
            <table class="tbl">
              <thead><tr><th>Date &amp; time</th><th>Event</th><th>Reference</th><th>Details</th><th>Performed by</th></tr></thead>
              <tbody>${rows || '<tr><td colspan="5" style="text-align:center;padding:1.5rem;color:var(--text-tertiary)">No audited events yet.</td></tr>'}</tbody>
            </table>
          </div>
        </div>
      </div>`;
    if (targetId === 'audit-log-content') container.innerHTML = html;
    else container.insertAdjacentHTML('beforeend', html);
  },

  async saveSystemConfiguration(evt) {
    if (evt) evt.preventDefault();
    const data = DataStore.get();
    if (!this.canManageSystemConfiguration(data.activeRole)) {
      alert('Only Super Admin can update system configuration.');
      return;
    }
    const sessionTimeout = parseInt(document.getElementById('config-session')?.value, 10);
    const databasePort = parseInt(document.getElementById('config-db-port')?.value, 10);
    const minPasswordLength = parseInt(document.getElementById('config-password-min')?.value, 10);
    const passwordExpiryDays = parseInt(document.getElementById('config-password-expiry')?.value, 10);
    const maxLoginAttempts = parseInt(document.getElementById('config-login-attempts')?.value, 10);
    const lockoutMinutes = parseInt(document.getElementById('config-lockout')?.value, 10);
    const ipWhitelist = (document.getElementById('config-ip-whitelist')?.value || '')
      .split(/[\n,]+/)
      .map(value => value.trim())
      .filter(Boolean);
    const validIPv4 = value => {
      const octets = value.split('.');
      return octets.length === 4 && octets.every(o => /^\d{1,3}$/.test(o) && Number(o) <= 255);
    };
    const validCIDR = value => {
      const parts = value.split('/');
      const prefix = Number(parts[1]);
      return parts.length === 2 && validIPv4(parts[0]) && /^\d{1,2}$/.test(parts[1]) && prefix >= 0 && prefix <= 32;
    };
    const invalidIP = ipWhitelist.find(value => !validIPv4(value) && !validCIDR(value));
    if (invalidIP) {
      alert(`Invalid IP address or CIDR range: ${invalidIP}`);
      return;
    }
    if (!(sessionTimeout >= 5 && sessionTimeout <= 480)) {
      alert('Session timeout must be between 5 and 480 minutes.');
      return;
    }
    if (!(databasePort >= 1 && databasePort <= 65535)) {
      alert('Database port must be between 1 and 65535.');
      return;
    }
    if (!(minPasswordLength >= 8 && minPasswordLength <= 32)) {
      alert('Minimum password length must be between 8 and 32 characters.');
      return;
    }
    if (!(passwordExpiryDays >= 0 && passwordExpiryDays <= 365)) {
      alert('Password expiry must be between 0 and 365 days.');
      return;
    }
    if (!(maxLoginAttempts >= 3 && maxLoginAttempts <= 10)) {
      alert('Maximum login attempts must be between 3 and 10.');
      return;
    }
    if (!(lockoutMinutes >= 1 && lockoutMinutes <= 1440)) {
      alert('Account lockout duration must be between 1 and 1440 minutes.');
      return;
    }
    data.systemConfig = {
      orgName: (document.getElementById('config-org-name')?.value || '').trim(),
      currency: document.getElementById('config-currency')?.value || 'KES',
      timezone: document.getElementById('config-timezone')?.value || 'Africa/Nairobi',
      sessionTimeout,
      database: {
        engine: document.getElementById('config-db-engine')?.value || 'LOCAL_STORAGE',
        name: (document.getElementById('config-db-name')?.value || '').trim(),
        host: (document.getElementById('config-db-host')?.value || '').trim(),
        port: databasePort,
        username: (document.getElementById('config-db-user')?.value || '').trim(),
        ssl: document.getElementById('config-db-ssl')?.value || 'DISABLED'
      },
      security: {
        minPasswordLength,
        passwordExpiryDays,
        maxLoginAttempts,
        lockoutMinutes,
        mfa: document.getElementById('config-mfa')?.value || 'OPTIONAL',
        auditLogging: document.getElementById('config-audit')?.value || 'ENABLED',
        ipWhitelist
      }
    };
    DataStore.save(data);
    try {
      const backendUpdated = await this.syncBackendSecurityConfig(data.systemConfig);
      alert(backendUpdated
        ? 'System configuration saved successfully and authentication enforcement was updated on the backend.'
        : 'Configuration saved locally. Backend enforcement was not updated because sign-in is disabled.');
    } catch (error) {
      alert(`Configuration saved locally, but backend enforcement was not updated: ${error.message}`);
    }
    this.renderSystemConfiguration();
  },

  renderNotificationsList() {
    const data = DataStore.get();
    const role = data.activeRole;
    const container = document.getElementById('noti-list-content');
    if (!container) return;

    const notis = (data.notifications || []).filter(n => n.role === role || role === 'OVERALL_ADMIN' || role === 'SUPER_ADMIN');

    if (!notis.length) {
      container.innerHTML = `
        <div style="text-align:center;padding:2rem;color:var(--text-tertiary)">
          <i class="ti ti-bell-off" style="font-size:28px;display:block;margin-bottom:6px"></i>
          No notifications for role <strong>${data.roles[role]?.title}</strong>.
        </div>`;
      return;
    }

    const nowMs = Date.now();
    container.innerHTML = notis.map(n => `
      <div class="noti-item" onclick="App.handleNotiClick(${n.id}, '${n.appId}')">
        <div class="noti-dot ${n.read ? 'read' : ''}"></div>
        <div style="flex:1">
          <div style="font-weight:${n.read ? 400 : 700};color:var(--text-primary)">${n.message}</div>
          <div style="font-size:11px;color:var(--text-secondary);margin-top:2px">${this.timeAgoFromString(n.time, nowMs)} · Target: ${data.roles[n.role]?.title || n.role}</div>
        </div>
      </div>
    `).join('');
  },

  timeAgoFromString(timeString, nowMs = Date.now()) {
    if (!timeString) return 'just now';
    const parsed = new Date(timeString.replace(' ', 'T'));
    if (isNaN(parsed.getTime())) return timeString;
    const diffSec = Math.max(0, Math.floor((nowMs - parsed.getTime()) / 1000));
    if (diffSec < 60) return 'just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return `${diffDay}d ago`;
    if (diffDay < 365) return parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
    return parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  },

  handleNotiClick(notiId, appId) {
    const data = DataStore.get();
    const n = (data.notifications || []).find(x => x.id === notiId);
    if (n) n.read = true;
    DataStore.save(data);
    this.updateNotifications();

    // Collections roles stay on live loan accounts, never LOS onboarding
    if (this.isCollectionsRole(data.activeRole)) {
      if (appId?.startsWith('ACC-')) {
        const loan = (data.loans || []).find(l => l.accountNumber === appId);
        if (loan?.release) LMSModule.openReleaseWorkflow(appId);
        else LMSModule.openLoan360(appId);
      } else if (appId?.startsWith('LBL-')) {
        const loan = (data.loans || []).find(l => l.appId === appId);
        if (loan) LMSModule.openLoan360(loan.accountNumber);
        else this.showTab('loans');
      }
      return;
    }

    if (appId?.startsWith('LBL-')) {
      LOSModule.openApplicationDetail(appId);
    } else if (appId?.startsWith('ACC-')) {
      const loan = (data.loans || []).find(l => l.accountNumber === appId);
      if (loan?.release) LMSModule.openReleaseWorkflow(appId);
      else LMSModule.openLoan360(appId);
    }
  },

  markAllNotificationsRead() {
    const data = DataStore.get();
    const role = data.activeRole;
    (data.notifications || []).forEach(n => {
      if (n.role === role || role === 'OVERALL_ADMIN' || role === 'SUPER_ADMIN') n.read = true;
    });
    DataStore.save(data);
    this.renderNotificationsList();
    this.updateNotifications();
  },

  // Global Quick Search across Applications, Loans, and Collateral
  globalSearch(rawQuery) {
    const q = (rawQuery || '').trim().toLowerCase();
    const dropdown = document.getElementById('global-search-results');
    if (!dropdown) return;

    if (q.length < 2) {
      dropdown.classList.remove('active');
      dropdown.innerHTML = '';
      return;
    }

    const data = DataStore.get();
    const collectionsRole = this.isCollectionsRole(data.activeRole);
    const matchApps = collectionsRole ? [] : (data.applications || []).filter(a => 
      a.id.toLowerCase().includes(q) || a.customer.toLowerCase().includes(q) || a.reg.toLowerCase().includes(q) || a.vehicle.toLowerCase().includes(q)
    ).slice(0, 3);

    const matchLoans = (data.loans || []).filter(l => 
      l.accountNumber.toLowerCase().includes(q) || l.customer.toLowerCase().includes(q) || l.reg.toLowerCase().includes(q)
    ).slice(0, 3);

    const matchVault = (data.collateralVault || []).filter(v => 
      v.regNumber.toLowerCase().includes(q) || v.logbookNumber.toLowerCase().includes(q) || v.ownerName.toLowerCase().includes(q)
    ).slice(0, 2);

    if (!matchApps.length && !matchLoans.length && !matchVault.length) {
      dropdown.innerHTML = '<div style="padding:12px;font-size:12px;color:var(--text-tertiary);text-align:center">No matching records found.</div>';
      dropdown.classList.add('active');
      return;
    }

    let html = '';
    if (matchApps.length) {
      html += '<div class="search-group-header">LOS Applications</div>';
      html += matchApps.map(a => `
        <div class="search-result-item" onclick="document.getElementById('global-search-results').classList.remove('active');LOSModule.openApplicationDetail('${a.id}')">
          <div>
            <div style="font-weight:600;font-size:12px">${a.customer}</div>
            <div style="font-size:10.5px;color:var(--text-secondary)"><span class="app-num">${a.id}</span> · ${a.vehicle} (${a.reg})</div>
          </div>
          <span class="badge b-${a.status.toLowerCase()}">${a.status.replace(/_/g, ' ').toLowerCase()}</span>
        </div>
      `).join('');
    }

    if (matchLoans.length) {
      html += '<div class="search-group-header">LMS Active Loans</div>';
      html += matchLoans.map(l => {
        const open = l.release
          ? `LMSModule.openReleaseWorkflow('${l.accountNumber}')`
          : `LMSModule.openLoan360('${l.accountNumber}')`;
        return `
        <div class="search-result-item" onclick="document.getElementById('global-search-results').classList.remove('active');${open}">
          <div>
            <div style="font-weight:600;font-size:12px">${l.customer}</div>
            <div style="font-size:10.5px;color:var(--text-secondary)"><span class="app-num">${l.accountNumber}</span> · ${l.reg}</div>
          </div>
          <span style="font-weight:700;font-size:11.5px;color:#059669">${l.release ? (l.release.status || '').replace(/_/g, ' ') : FinEngine.kes(l.currentPrincipal)}</span>
        </div>
      `;
      }).join('');
    }

    if (matchVault.length) {
      html += '<div class="search-group-header">Collateral Safe Vault</div>';
      html += matchVault.map(v => `
        <div class="search-result-item" onclick="document.getElementById('global-search-results').classList.remove('active');LMSModule.openReleaseFromVault('${v.vaultId}')">
          <div>
            <div style="font-weight:600;font-size:12px">${v.regNumber} — ${v.ownerName}</div>
            <div style="font-size:10.5px;color:var(--text-secondary)">Logbook: ${v.logbookNumber} · ${v.location}</div>
          </div>
          <span class="badge ${v.status === 'IN_CUSTODY' ? 'b-active' : v.status === 'RELEASED' ? 'b-logbook_released' : v.status === 'PENDING_DISCHARGE' ? 'b-pending_discharge' : 'b-settled'}">${v.status.replace(/_/g, ' ')}</span>
        </div>
      `).join('');
    }

    dropdown.innerHTML = html;
    dropdown.classList.add('active');
  },

  nextProductCode() {
    const products = DataStore.get().products || [];
    let max = 0;
    products.forEach(p => {
      const m = String(p.id || '').match(/(\d+)\s*$/);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return `PRD-LBL-${String(max + 1).padStart(2, '0')}`;
  },

  readProductForm() {
    const name = (document.getElementById('prd-name')?.value || '').trim();
    const code = (document.getElementById('prd-code')?.value || '').trim().toUpperCase().replace(/\s+/g, '-');
    const minTenor = parseInt(document.getElementById('prd-min-tenor')?.value, 10) || 1;
    const maxTenor = parseInt(document.getElementById('prd-max-tenor')?.value, 10) || minTenor;
    const minAmount = parseFloat(document.getElementById('prd-min-amt')?.value) || 0;
    const maxAmount = parseFloat(document.getElementById('prd-max-amt')?.value) || 0;
    const defaultRate = parseFloat(document.getElementById('prd-rate')?.value);
    const maxLTV = parseFloat(document.getElementById('prd-ltv')?.value);
    return {
      id: document.getElementById('prd-id')?.value || '',
      name,
      code,
      description: (document.getElementById('prd-desc')?.value || '').trim() || 'Original Logbook + Joint Caveat',
      status: document.getElementById('prd-status')?.value || 'ACTIVE',
      interestModel: 'FLAT',
      defaultRate,
      minTenor,
      maxTenor,
      minAmount,
      maxAmount,
      maxLTV,
      trackingFee: parseFloat(document.getElementById('prd-track')?.value) || 0,
      penaltyRate: parseFloat(document.getElementById('prd-pen')?.value) || 5,
      graceDays: parseInt(document.getElementById('prd-grace')?.value, 10) || 7
    };
  },

  openProductModal(productId) {
    if (!this.canManageProducts()) {
      alert('Only Overall Admin can add or edit loan products and credit policy.');
      return;
    }
    const modal = document.getElementById('product-modal');
    const form = document.getElementById('product-form');
    if (!modal || !form) return;
    form.reset();

    const data = DataStore.get();
    const p = productId ? (data.products || []).find(x => x.id === productId) : null;
    const title = document.getElementById('product-modal-title');
    const delBtn = document.getElementById('prd-delete-btn');
    const saveBtn = document.getElementById('prd-save-btn');

    if (p) {
      if (title) title.innerHTML = `<i class="ti ti-settings-dollar"></i> Edit Loan Product`;
      document.getElementById('prd-id').value = p.id;
      document.getElementById('prd-name').value = p.name || '';
      document.getElementById('prd-code').value = p.id || '';
      document.getElementById('prd-status').value = p.status || 'ACTIVE';
      document.getElementById('prd-desc').value = p.description || '';
      document.getElementById('prd-rate').value = p.defaultRate ?? 5;
      document.getElementById('prd-min-tenor').value = p.minTenor ?? 3;
      document.getElementById('prd-max-tenor').value = p.maxTenor ?? 24;
      document.getElementById('prd-min-amt').value = p.minAmount ?? 0;
      document.getElementById('prd-max-amt').value = p.maxAmount ?? 0;
      document.getElementById('prd-ltv').value = p.maxLTV ?? 80;
      document.getElementById('prd-track').value = p.trackingFee ?? 0;
      document.getElementById('prd-pen').value = p.penaltyRate ?? 5;
      document.getElementById('prd-grace').value = p.graceDays ?? 7;
      if (delBtn) delBtn.style.display = 'inline-flex';
      if (saveBtn) saveBtn.innerHTML = '<i class="ti ti-check"></i> Update product';
    } else {
      if (title) title.innerHTML = `<i class="ti ti-plus"></i> Add Loan Product`;
      document.getElementById('prd-id').value = '';
      document.getElementById('prd-code').value = this.nextProductCode();
      document.getElementById('prd-status').value = 'ACTIVE';
      document.getElementById('prd-desc').value = 'Original logbook + NTSA joint caveat';
      document.getElementById('prd-rate').value = 5;
      document.getElementById('prd-min-tenor').value = 3;
      document.getElementById('prd-max-tenor').value = 24;
      document.getElementById('prd-min-amt').value = 50000;
      document.getElementById('prd-max-amt').value = 5000000;
      document.getElementById('prd-ltv').value = 80;
      document.getElementById('prd-track').value = 0;
      document.getElementById('prd-pen').value = 5;
      document.getElementById('prd-grace').value = 7;
      if (delBtn) delBtn.style.display = 'none';
      if (saveBtn) saveBtn.innerHTML = '<i class="ti ti-check"></i> Save product';
    }

    modal.classList.add('active');
    document.getElementById('prd-name')?.focus();
  },

  closeProductModal() {
    document.getElementById('product-modal')?.classList.remove('active');
  },

  saveProduct(evt) {
    if (evt) evt.preventDefault();
    if (!this.canManageProducts()) {
      alert('Only Overall Admin can save loan products and credit policy.');
      return;
    }
    const form = this.readProductForm();
    if (!form.name) {
      alert('Enter a product name.');
      return;
    }
    if (!(form.defaultRate >= 0)) {
      alert('Enter a valid monthly interest rate.');
      return;
    }
    if (!(form.maxAmount > 0)) {
      alert('Enter a maximum facility amount.');
      return;
    }
    if (form.minTenor > form.maxTenor) {
      alert('Minimum tenor cannot exceed maximum tenor.');
      return;
    }
    if (form.minAmount > form.maxAmount) {
      alert('Minimum facility cannot exceed maximum facility.');
      return;
    }
    if (!(form.maxLTV > 0 && form.maxLTV <= 100)) {
      alert('Max LTV must be between 1 and 100.');
      return;
    }

    const data = DataStore.get();
    data.products = data.products || [];
    const existingId = form.id;
    let code = form.code || (existingId ? existingId : this.nextProductCode());
    const clash = data.products.find(p => p.id === code && p.id !== existingId);
    if (clash) {
      alert(`Product code ${code} is already in use.`);
      return;
    }

    const record = {
      id: existingId || code,
      name: form.name,
      description: form.description,
      interestModel: 'FLAT',
      maxLTV: form.maxLTV,
      minTenor: form.minTenor,
      maxTenor: form.maxTenor,
      minAmount: form.minAmount,
      maxAmount: form.maxAmount,
      defaultRate: form.defaultRate,
      trackingFee: form.trackingFee,
      penaltyRate: form.penaltyRate,
      graceDays: form.graceDays,
      status: form.status
    };

    if (existingId) {
      const idx = data.products.findIndex(p => p.id === existingId);
      if (idx < 0) {
        alert('Product no longer exists.');
        return;
      }
      if (code && code !== existingId) record.id = code;
      data.products[idx] = { ...data.products[idx], ...record };
    } else {
      data.products.push(record);
    }

    DataStore.save(data);
    this.closeProductModal();
    this.renderProducts();
    if (typeof LOSModule !== 'undefined') LOSModule.populateProductSelect();
  },

  deleteProduct() {
    if (!this.canManageProducts()) {
      alert('Only Overall Admin can remove loan products.');
      return;
    }
    const id = document.getElementById('prd-id')?.value;
    if (!id) return;
    const data = DataStore.get();
    const p = (data.products || []).find(x => x.id === id);
    if (!p) return;
    if (!confirm(`Remove loan product “${p.name}”? Existing applications keep their saved terms.`)) return;
    data.products = (data.products || []).filter(x => x.id !== id);
    DataStore.save(data);
    this.closeProductModal();
    this.renderProducts();
    if (typeof LOSModule !== 'undefined') LOSModule.populateProductSelect();
  },

  // Render Loan Products & Credit Policy Configuration Tab
  renderProducts() {
    const data = DataStore.get();
    const container = document.getElementById('products-content');
    if (!container) return;

    if (!this.canManageProducts(data.activeRole)) {
      this.closeProductModal();
      container.innerHTML = `
        <div class="card">
          <div class="card-body" style="text-align:center;padding:2.5rem;color:var(--text-tertiary)">
            <i class="ti ti-lock" style="font-size:32px;display:block;margin-bottom:8px;color:#0284C7"></i>
            Products &amp; Policy is restricted to <strong>Overall Admin</strong>.
            <div style="font-size:12px;margin-top:6px">Switch role to Overall Admin to configure loan products and credit policy.</div>
          </div>
        </div>`;
      return;
    }

    const prods = data.products || [];

    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.25rem;gap:12px;flex-wrap:wrap">
        <div>
          <div style="font-size:18px;font-weight:700;color:var(--brand-primary)">Credit Products & Underwriting Policy Configuration</div>
          <div style="font-size:12px;color:var(--text-secondary)">Overall Admin only. Add, edit or deactivate lending facilities. Active products appear on New Application.</div>
        </div>
        <button class="btn btn-primary" onclick="App.openProductModal()">
          <i class="ti ti-plus"></i> Add Loan Product
        </button>
      </div>

      ${!prods.length ? `
        <div class="card">
          <div class="card-body" style="text-align:center;padding:2.5rem;color:var(--text-tertiary)">
            <i class="ti ti-settings-dollar" style="font-size:32px;display:block;margin-bottom:8px"></i>
            No loan products yet. Click <strong>Add Loan Product</strong> to create the first facility.
          </div>
        </div>
      ` : `
      <div class="products-grid" style="margin-bottom:1.5rem">
        ${prods.map(p => `
          <div class="product-card ${p.status === 'INACTIVE' ? 'is-inactive' : ''}">
            <span class="product-badge-ltv">Max ${p.maxLTV}% LTV</span>
            <div>
              <div style="font-size:15px;font-weight:700;color:var(--brand-primary);margin-bottom:6px;padding-right:72px">${p.name}</div>
              <div style="font-size:11px;color:var(--text-secondary);font-family:var(--font-mono);margin-bottom:8px">${p.id}
                <span class="badge ${p.status === 'INACTIVE' ? 'b-settled' : 'b-active'}" style="margin-left:6px">${p.status === 'INACTIVE' ? 'Inactive' : 'Active'}</span>
              </div>
              
              <div class="detail-row"><span class="detail-label">Default Interest Rate</span><span class="detail-val" style="color:#0284C7">${p.defaultRate}% p.m. flat</span></div>
              <div class="detail-row"><span class="detail-label">Facility range</span><span class="detail-val" style="color:#059669">${FinEngine.kes(p.minAmount || 0)} – ${FinEngine.kes(p.maxAmount)}</span></div>
              <div class="detail-row"><span class="detail-label">Allowed Tenor</span><span class="detail-val">${p.minTenor} to ${p.maxTenor} Months</span></div>
              <div class="detail-row"><span class="detail-label">Tracking / Penalty</span><span class="detail-val">${FinEngine.kes(p.trackingFee || 0)} / mo · ${p.penaltyRate || 5}% after ${p.graceDays || 7}d</span></div>
              <div class="detail-row"><span class="detail-label">Collateral Requirement</span><span class="detail-val">${p.description || 'Original Logbook + Joint Caveat'}</span></div>
            </div>
            <div style="margin-top:14px;display:flex;gap:8px">
              <button class="btn btn-sm btn-primary" style="flex:1" onclick="App.openProductModal('${p.id}')">
                <i class="ti ti-edit"></i> Edit Terms
              </button>
            </div>
          </div>
        `).join('')}
      </div>
      `}

      <!-- Credit Policy Governance & Regulatory Standards Card -->
      <div class="card">
        <div class="card-header">
          <div class="card-title-group">
            <i class="ti ti-gavel" style="font-size:18px;color:#0284C7"></i>
            <span class="card-title">Spectrum Credit Governance & Risk Policy Rules</span>
          </div>
          <span class="badge" style="background:#ECFDF5;color:#059669">Policy Version 2025.2</span>
        </div>
        <div class="card-body">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div>
              <div class="section-label" style="margin-top:0">Mandatory Governance Ceilings</div>
              <div class="detail-row"><span class="detail-label">CEO / Committee Approval Limit</span><span class="detail-val" style="color:#DC2626">> KES 2,000,000 (Mandatory)</span></div>
              <div class="detail-row"><span class="detail-label">Maximum Loan-to-Value (LTV) Cap</span><span class="detail-val">80.0% of Appraised FSV</span></div>
              <div class="detail-row"><span class="detail-label">Maximum Debt-to-Income (DTI)</span><span class="detail-val">65.0% of Verified Net Income</span></div>
              <div class="detail-row"><span class="detail-label">Maximum Vehicle Age Threshold</span><span class="detail-val">15 Years from Year of Manufacture</span></div>
            </div>

            <div>
              <div class="section-label" style="margin-top:0">Servicing & Recovery Parameters</div>
              <div class="detail-row"><span class="detail-label">Late Payment Penalty Fee</span><span class="detail-val" style="color:#DC2626">5.0% on Overdue Monthly Installment</span></div>
              <div class="detail-row"><span class="detail-label">Statutory Notice Cure Period</span><span class="detail-val">14 Calendar Days (Chattels Transfer Act)</span></div>
              <div class="detail-row"><span class="detail-label">Early Payoff Prompt Settlement Rebate</span><span class="detail-val" style="color:#059669">1.0% Discount on Outstanding Principal</span></div>
              <div class="detail-row"><span class="detail-label">Logbook Dual-Custody Protocol</span><span class="detail-val">Dual Authorization Required for Safe Release</span></div>
            </div>
          </div>
        </div>
      </div>
    `;
  },

};

