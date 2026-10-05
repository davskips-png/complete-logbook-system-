/**
 * Spectrum Credit Limited - Seed Data & State Persistence Manager
 * Starts with empty customer records and keeps operational data in browser storage.
 */

const STORAGE_KEY = 'SPECTRUM_LMS_LOS_DATA_V1';
const DRAFT_STORAGE_KEY = 'SPECTRUM_LOS_APPLICATION_DRAFT_V1';

const INITIAL_DATA = {
  activeRole: 'BRANCH_ADMIN',
  currentTab: 'dashboard',
  captureCleared: true,
  selectedAppId: null,
  selectedLoanId: null,

  roles: {
    BRANCH_ADMIN: { title: 'Branch Admin', desc: 'Application intake, KYC, documents upload, customer service' },
    RISK_OFFICER: { title: 'Risk Officer', desc: 'Credit risk assessment, vehicle appraisal, condition verification' },
    CREDIT_RISK_MANAGER: { title: 'Credit Risk Manager', desc: 'First approval, set credit terms/CPs, final approval' },
    CREDIT_ADMIN: { title: 'Credit Admin', desc: 'Book facilities, generate amortization schedule, logbook custody' },
    FINANCE_OFFICER: { title: 'Finance Officer', desc: 'Prepare payment vouchers, process repayments & receipts' },
    FINANCE_MANAGER: { title: 'Finance Manager', desc: 'Disbursement authorization, treasury, write-off approvals' },
    COLLECTION_OFFICER: { title: 'Collection & Recovery Officer', desc: 'Arrears follow-up, reminder notices, field collections, PAR 1–60' },
    COLLECTION_MANAGER: { title: 'Collection & Recovery Manager', desc: 'Statutory demand, repossession, legal recoveries, PAR 61+' },
    OVERALL_ADMIN: { title: 'Overall Admin', desc: 'Products & credit policy, system management, SLA overrides, comprehensive audit' },
    SUPER_ADMIN: { title: 'Super Admin', desc: 'Full system access, security administration, policy and audit oversight' },
    CEO_COMMITTEE: { title: 'CEO / Committee', desc: 'High-value approvals (> KES 2M) and restructuring' }
  },

  branches: [
    { id: 'BR-001', name: 'Nairobi Main Branch', code: 'BR001', location: 'Nairobi', phone: '0201234567', manager: 'John Doe', status: 'ACTIVE' }
  ],
  staff: [
    { id: 'ST-001', name: 'Branch Admin User', email: 'branchadmin@spectrum.com', password: 'Spectrum@2026', phone: '0712345678', gender: 'MALE', role: 'BRANCH_ADMIN', branch: 'BR-001', status: 'ACTIVE' },
    { id: 'ST-002', name: 'Risk Officer User', email: 'riskofficer@spectrum.com', password: 'Spectrum@2026', phone: '0712345679', gender: 'FEMALE', role: 'RISK_OFFICER', branch: 'BR-001', status: 'ACTIVE' },
    { id: 'ST-003', name: 'Credit Risk Manager User', email: 'creditriskmanager@spectrum.com', password: 'Spectrum@2026', phone: '0712345680', gender: 'MALE', role: 'CREDIT_RISK_MANAGER', branch: 'BR-001', status: 'ACTIVE' },
    { id: 'ST-004', name: 'Credit Admin User', email: 'creditadmin@spectrum.com', password: 'Spectrum@2026', phone: '0712345681', gender: 'FEMALE', role: 'CREDIT_ADMIN', branch: 'BR-001', status: 'ACTIVE' },
    { id: 'ST-005', name: 'Finance Officer User', email: 'financeofficer@spectrum.com', password: 'Spectrum@2026', phone: '0712345682', gender: 'MALE', role: 'FINANCE_OFFICER', branch: 'BR-001', status: 'ACTIVE' },
    { id: 'ST-006', name: 'Finance Manager User', email: 'financemanager@spectrum.com', password: 'Spectrum@2026', phone: '0712345683', gender: 'FEMALE', role: 'FINANCE_MANAGER', branch: 'BR-001', status: 'ACTIVE' },
    { id: 'ST-007', name: 'Collection Officer User', email: 'collectionofficer@spectrum.com', password: 'Spectrum@2026', phone: '0712345684', gender: 'MALE', role: 'COLLECTION_OFFICER', branch: 'BR-001', status: 'ACTIVE' },
    { id: 'ST-008', name: 'Collection Manager User', email: 'collectionmanager@spectrum.com', password: 'Spectrum@2026', phone: '0712345685', gender: 'FEMALE', role: 'COLLECTION_MANAGER', branch: 'BR-001', status: 'ACTIVE' },
    { id: 'ST-009', name: 'Overall Admin User', email: 'overalladmin@spectrum.com', password: 'Spectrum@2026', phone: '0712345686', gender: 'MALE', role: 'OVERALL_ADMIN', branch: 'BR-001', status: 'ACTIVE' },
    { id: 'ST-010', name: 'Super Admin User', email: 'superadmin@spectrum.com', password: 'Spectrum@2026', phone: '0712345687', gender: 'FEMALE', role: 'SUPER_ADMIN', branch: 'BR-001', status: 'ACTIVE' },
    { id: 'ST-011', name: 'CEO Committee User', email: 'ceocommittee@spectrum.com', password: 'Spectrum@2026', phone: '0712345688', gender: 'MALE', role: 'CEO_COMMITTEE', branch: 'BR-001', status: 'ACTIVE' }
  ],

  products: [
    { id: 'PRD-LBL-01', name: 'Private Vehicle Logbook Loan', description: 'Original logbook + NTSA joint caveat', interestModel: 'FLAT', maxLTV: 80, minTenor: 3, maxTenor: 24, minAmount: 50000, maxAmount: 5000000, defaultRate: 5.0, trackingFee: 0, penaltyRate: 5, graceDays: 7, status: 'ACTIVE' },
    { id: 'PRD-LBL-02', name: 'Commercial Fleet & Truck Loan', description: 'Fleet logbooks + GPS tracking', interestModel: 'FLAT', maxLTV: 70, minTenor: 6, maxTenor: 36, minAmount: 200000, maxAmount: 10000000, defaultRate: 5.5, trackingFee: 3000, penaltyRate: 5, graceDays: 7, status: 'ACTIVE' },
    { id: 'PRD-LBL-03', name: 'Quick Refinance / Loan Buyoff', description: 'Takeover of existing logbook facility', interestModel: 'FLAT', maxLTV: 75, minTenor: 3, maxTenor: 18, minAmount: 100000, maxAmount: 3500000, defaultRate: 4.5, trackingFee: 0, penaltyRate: 5, graceDays: 7, status: 'ACTIVE' }
  ],

  // Customer records are not included in source-controlled seed data.
  applications: [],
  loans: [],
  collateralVault: [],
  generalLedger: [],
  notifications: [],
  auditLog: []
};

const DataStore = {
  get() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        data.roles = { ...(data.roles || {}), ...INITIAL_DATA.roles };
        (data.loans || []).forEach(loan => {
          if (!Array.isArray(loan.collectionsLog)) loan.collectionsLog = [];
          if (loan.noticeStage == null) loan.noticeStage = loan.daysPastDue > 60 ? 2 : loan.daysPastDue > 0 ? 1 : 0;
          if (loan.assignedCollectionsRole === undefined) {
            loan.assignedCollectionsRole = loan.daysPastDue > 60 ? 'COLLECTION_MANAGER' : (loan.daysPastDue > 0 ? 'COLLECTION_OFFICER' : null);
          }
          if (loan.trackingFee == null) loan.trackingFee = 0;
          if (loan.penaltyRate == null) loan.penaltyRate = 5;
          if (loan.graceDays == null) loan.graceDays = 7;
        });
        if (!Array.isArray(data.branches)) data.branches = [];
        if (!Array.isArray(data.staff)) data.staff = [];
        if (!Array.isArray(data.auditLog)) data.auditLog = [];
        if (!Array.isArray(data.products)) {
          data.products = JSON.parse(JSON.stringify(INITIAL_DATA.products));
        } else {
          data.products.forEach(product => {
            if (product.minAmount == null) product.minAmount = 0;
            if (product.trackingFee == null) product.trackingFee = 0;
            if (product.penaltyRate == null) product.penaltyRate = 5;
            if (product.graceDays == null) product.graceDays = 7;
            if (!product.status) product.status = 'ACTIVE';
            if (!product.description) product.description = 'Original Logbook + Joint Caveat';
            if (!product.interestModel) product.interestModel = 'FLAT';
          });
        }
        (data.applications || []).forEach(application => {
          if (!application.branch) application.branch = 'BR-001';
          if (application.requestedDuration == null) application.requestedDuration = application.approvedDuration || 12;
          if (application.requestedRate == null) application.requestedRate = application.approvedRate || 5;
          if (application.trackingFee == null) application.trackingFee = 0;
          if (application.penaltyRate == null) application.penaltyRate = 5;
          if (application.graceDays == null) application.graceDays = 7;
          if (!application.proposedDisbursementDate) application.proposedDisbursementDate = application.createdAt || null;
        });
        return data;
      }
    } catch (error) {
      console.warn('Could not read from localStorage, using initial dataset', error);
    }

    const blankData = JSON.parse(JSON.stringify(INITIAL_DATA));
    this.save(blankData);
    return blankData;
  },

  save(data) {
    try {
      let previous = null;
      try {
        previous = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      } catch (_) {}

      data.auditLog = Array.isArray(data.auditLog) ? data.auditLog : [];
      if (previous) {
        const role = data.activeRole || 'UNKNOWN';
        const actor = data.roles?.[role]?.title || role;
        const at = new Date().toISOString();
        const oldStaffIds = new Set((previous.staff || []).map(staff => staff.id));
        (data.staff || []).filter(staff => staff.id && !oldStaffIds.has(staff.id)).forEach(staff => {
          data.auditLog.unshift({
            id: `AUD-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            action: 'User created',
            entityType: 'USER',
            entityId: staff.id,
            details: `${staff.name || 'Unnamed user'} · ${staff.email || 'No email'} · ${data.roles?.[staff.role]?.title || staff.role || 'No role'}`,
            by: actor,
            role,
            at
          });
        });
        (previous.staff || []).filter(staff => staff.id && !(data.staff || []).some(current => current.id === staff.id)).forEach(staff => {
          data.auditLog.unshift({
            id: `AUD-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            action: 'User deleted',
            entityType: 'USER',
            entityId: staff.id,
            details: `${staff.name || 'Unnamed user'} · ${staff.email || 'No email'} · ${data.roles?.[staff.role]?.title || staff.role || 'No role'}`,
            by: actor,
            role,
            at
          });
        });

        const oldApplicationIds = new Set((previous.applications || []).map(application => application.id).filter(Boolean));
        (data.applications || []).filter(application => application.id && !oldApplicationIds.has(application.id)).forEach(application => {
          data.auditLog.unshift({
            id: `AUD-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            action: 'Customer account created',
            entityType: 'CUSTOMER_ACCOUNT',
            entityId: application.id,
            details: `${application.customer || 'Unnamed customer'} · ${application.phone || 'No phone'} · ${application.reg || 'Vehicle not specified'}`,
            by: actor,
            role,
            at
          });
        });

        const oldLoanIds = new Set((previous.loans || []).map(loan => loan.accountNumber).filter(Boolean));
        const oldAppStatuses = new Map((previous.applications || []).map(application => [application.id, application.status]));
        const disbursedApps = new Set((data.applications || [])
          .filter(application => application.status === 'DISBURSED' && oldAppStatuses.get(application.id) !== 'DISBURSED')
          .map(application => application.id));
        (data.loans || []).filter(loan =>
          (loan.accountNumber && !oldLoanIds.has(loan.accountNumber)) || disbursedApps.has(loan.appId)
        ).forEach(loan => {
          data.auditLog.unshift({
            id: `AUD-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            action: 'Loan disbursed',
            entityType: 'LOAN',
            entityId: loan.accountNumber || loan.appId || '—',
            details: `${loan.customer || 'Customer'} · ${loan.reg || 'Vehicle not specified'} · ${typeof FinEngine !== 'undefined' ? FinEngine.kes(loan.disbursedAmount || loan.amount || 0) : (loan.disbursedAmount || loan.amount || 0)}`,
            by: actor,
            role,
            at
          });
        });
        data.auditLog = data.auditLog.slice(0, 500);
      }

      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      return true;
    } catch (error) {
      try {
        const fallback = JSON.parse(JSON.stringify(data));
        const stripEmbeddedFiles = value => {
          if (!value || typeof value !== 'object') return;
          Object.entries(value).forEach(([key, child]) => {
            if (key === 'dataUrl' && typeof child === 'string') value[key] = '';
            else stripEmbeddedFiles(child);
          });
        };
        stripEmbeddedFiles(fallback);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback));
        console.info('Saved application data without embedded file binaries; document metadata was retained.');
        return true;
      } catch (fallbackError) {
        console.error('Failed to save application data locally.', fallbackError);
        return false;
      }
    }
  },

  reset() {
    return this.clearCapturedData();
  },

  clearCapturedData() {
    const current = this.get();
    localStorage.removeItem(DRAFT_STORAGE_KEY);
    const data = JSON.parse(JSON.stringify(INITIAL_DATA));
    data.activeRole = current.activeRole || 'SUPER_ADMIN';
    data.currentTab = 'dashboard';
    data.selectedAppId = null;
    data.selectedLoanId = null;
    data.branches = [];
    data.staff = [];
    this.save(data);
    localStorage.removeItem('spectrum-logbook-loan');
    localStorage.removeItem('davie-logbook-loan');
    return data;
  }
};

if (typeof window !== 'undefined') {
  window.DataStore = DataStore;
}
