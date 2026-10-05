/**
 * Spectrum Credit Limited - Loan Origination System (LOS) Module
 * Handles Application Intake, Collateral Appraisal, Credit Scoring,
 * Multi-Tier Governance Approvals, Conditions Precedent, and Handover to LMS.
 */

const LOSModule = {
  currentStep: 1,
  intakeDocs: {},
  _docCache: {},
  _pdfPreviewUrl: null,
  _htmlPreviewUrl: null,
  _undertakingDownloadUrl: null,

  DOC_SLOTS: [
    { id: 'id_front', label: 'National ID — Front' },
    { id: 'id_back', label: 'National ID — Back' },
    { id: 'national_id', label: 'National ID Front & Back', legacy: true },
    { id: 'kra_pin', label: 'KRA PIN Certificate' },
    { id: 'bank_statement', label: '6-Month Bank Statement' },
    { id: 'mpesa_statement', label: '6-Month M-Pesa Statement' },
    { id: 'logbook_copy', label: 'Original Logbook Copy' },
    { id: 'valuation_report', label: 'Valuation Report' }
  ],

  init() {
    this.renderApplicationsTable();
    this.initDocSlots();
    this.bindDraftAutosave();
  },

  bindDraftAutosave() {
    if (this._draftAutosaveBound) return;
    this._draftAutosaveBound = true;
    document.addEventListener('input', event => {
      if (event.target?.closest?.('#tab-new-application')) this.saveDraft();
    });
    document.addEventListener('change', event => {
      if (event.target?.closest?.('#tab-new-application')) this.saveDraft();
    });
  },

  canCreateApplication() {
    return (typeof App !== 'undefined' && App.canCreateApplication)
      ? App.canCreateApplication()
      : DataStore.get().activeRole === 'BRANCH_ADMIN';
  },

  resetIntakeWizard() {
    this.currentStep = 1;
    this.intakeDocs = {};
    this.clearDraft();
    this.initDocSlots();
  },

  draftFieldIds() {
    return [
      'n-name', 'n-id', 'n-kra', 'n-phone', 'n-email', 'n-address', 'n-town', 'n-biz', 'n-cr12', 'n-cert', 'n-bl',
      'n-product', 'n-amt', 'n-purpose', 'n-tenor', 'n-rate', 'n-track', 'n-pen', 'n-grace',
      'n-disb', 'n-firstDue', 'n-loan-type', 'n-buyoff-company', 'n-buyoff-address', 'n-buyoff-town',
      'n-buyoff-client', 'n-buyoff-reg', 'n-buyoff-id', 'n-buyoff-kra', 'n-lender', 'n-outstanding',
      'n-buyoff-amt', 'n-net', 'n-seller-name', 'n-seller-address', 'n-seller-town', 'n-asset-client',
      'n-asset-kra', 'n-reg', 'n-make', 'n-year', 'n-eng', 'n-chassis', 'n-val',
      'n-fsv', 'n-val-date', 'n-ins-expiry'
    ];
  },

  saveDraft() {
    if (!this.canCreateApplication()) return false;
    const fields = {};
    this.draftFieldIds().forEach(id => {
      const el = document.getElementById(id);
      if (el) fields[id] = el.value;
    });
    const customerType = document.querySelector('input[name="cust-type"]:checked')?.value || 'INDIVIDUAL';
    const draft = {
      fields,
      customerType,
      step: this.currentStep,
      documents: this.snapshotIntakeDocs(false),
      savedAt: new Date().toISOString()
    };
    try {
      localStorage.setItem('SPECTRUM_LOS_APPLICATION_DRAFT_V1', JSON.stringify(draft));
      return true;
    } catch (error) {
      // Keep the form data even when embedded document data exceeds localStorage.
      try {
        draft.documents = [];
        localStorage.setItem('SPECTRUM_LOS_APPLICATION_DRAFT_V1', JSON.stringify(draft));
        return true;
      } catch (_) {
        return false;
      }
    }
  },

  restoreDraft() {
    try {
      const raw = localStorage.getItem('SPECTRUM_LOS_APPLICATION_DRAFT_V1');
      if (!raw) return false;
      const draft = JSON.parse(raw);
      Object.entries(draft.fields || {}).forEach(([id, value]) => {
        const el = document.getElementById(id);
        if (el) el.value = value;
      });
      const type = document.querySelector(`input[name="cust-type"][value="${draft.customerType || 'INDIVIDUAL'}"]`);
      if (type) type.checked = true;
          this.intakeDocs = {};
    (draft.documents || []).forEach(doc => { this.intakeDocs[doc.id] = doc; });
    this.toggleBizFields();
      this.toggleLoanType();
      this.initDocSlots();
      this.goStep(Math.min(5, Math.max(1, Number(draft.step) || 1)));
      return true;
    } catch (error) {
      this.clearDraft();
      return false;
    }
  },

  clearDraft() {
    try { localStorage.removeItem('SPECTRUM_LOS_APPLICATION_DRAFT_V1'); } catch (_) {}
  },

  getDocSlots() {
    const slots = [...this.DOC_SLOTS];
    const product = this.selectedProduct();
    const aliases = {
      'national id (front and back)': 'national_id',
      'national id front and back': 'national_id',
      'kra pin certificate': 'kra_pin',
      'six-month bank statement': 'bank_statement',
      '6-month bank statement': 'bank_statement',
      'six-month m-pesa statement': 'mpesa_statement',
      '6-month m-pesa statement': 'mpesa_statement',
      'vehicle logbook copy': 'logbook_copy',
      'original logbook copy': 'logbook_copy',
      'vehicle valuation report': 'valuation_report',
      'valuation report': 'valuation_report'
    };
    (Array.isArray(product?.kycDocuments) ? product.kycDocuments : []).forEach(name => {
      const label = String(name || '').trim();
      if (!label) return;
      const standardId = aliases[label.toLowerCase()];
      if (standardId || slots.some(slot => slot.label.toLowerCase() === label.toLowerCase())) return;

      const baseId = `product_kyc_${label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'document'}`;
      let id = baseId;
      let suffix = 2;
      while (slots.some(slot => slot.id === id)) id = `${baseId}_${suffix++}`;
      slots.push({ id, label, productKyc: true });
    });
    return slots;
  },

  docSlot(id) {
    return this.getDocSlots().find(s => s.id === id) || { id, label: id };
  },

  renderProductKycDocSlots() {
    const container = document.getElementById('borrower-kyc-doc-grid');
    if (!container) return;
    const slots = this.getDocSlots().filter(slot => slot.productKyc);
    container.querySelectorAll('[data-product-kyc-slot]').forEach(box => box.remove());
    slots.forEach(slot => {
      const box = document.createElement('div');
      box.className = 'upload-box';
      box.id = `doc-box-${slot.id}`;
      box.dataset.docId = slot.id;
      box.dataset.productKycSlot = '1';
      box.onclick = event => this.openDocPicker(event, slot.id);
      box.innerHTML = `
        <input type="file" id="file-${slot.id}" accept=".pdf,.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp,application/pdf" onclick="event.stopPropagation()" onchange="LOSModule.handleDocUpload(event, '${this.escapeHtml(slot.id)}')">
        <div class="upload-box-inner" id="doc-inner-${slot.id}"></div>`;
      container.appendChild(box);
      this.renderDocSlot(slot.id);
    });
    this.bindDocDropzones();
  },

  escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  },

  renderKycDocumentCards(documents, appId = '') {
    const docs = Array.isArray(documents) ? documents.filter(Boolean) : [];
    const application = appId
      ? (DataStore.get().applications || []).find(item => item.id === appId)
      : null;
    [application?.crbResult, application?.ntsaResult].forEach(result => {
      if (result && !docs.some(doc => doc.id === result.id)) docs.push(result);
    });

    // Restore intake binaries when localStorage had to retain metadata only.
    let cachedDocs = this._docCache[appId] || [];
    if (appId && !cachedDocs.some(doc => doc?.dataUrl)) {
      try {
        const raw = sessionStorage.getItem(`SPECTRUM_DOC_CACHE_${appId}`);
        if (raw) {
          cachedDocs = JSON.parse(raw);
          this._docCache[appId] = cachedDocs;
        }
      } catch (error) {
        console.warn('Could not restore document cache from sessionStorage', error);
      }
    }
    docs.forEach((doc, index) => {
      if (!doc?.dataUrl) {
        const cached = cachedDocs.find(item => item?.id === doc?.id && item.dataUrl);
        if (cached) {
          docs[index] = {
            ...doc,
            ...cached,
            type: doc.type || cached.type || this.inferDocumentType(doc.name, cached.dataUrl)
          };
        }
      }
    });
    if (!docs.length) {
      return `<div class="kyc-empty-state"><i class="ti ti-files-off"></i><span>No KYC files were attached at intake.</span></div>`;
    }

    const groups = [
      {
        title: 'Customer KYC Files',
        ids: ['national_id', 'id_front', 'id_back', 'kra_pin'],
        emptyText: 'No customer identity documents attached.'
      },
      {
        title: 'Facility Application Documents',
        ids: ['application_form', 'signed_offer_letter', 'bank_statement', 'mpesa_statement', 'valuation_report'],
        emptyText: 'No facility application documents attached.'
      },
      {
        title: 'Asset Logbook Documents',
        ids: ['logbook_copy', 'insurance_details', 'tracking_certificate', 'ntsa_confirmation'],
        emptyText: 'No asset logbook documents attached.'
      },
      {
        title: 'Risk Assessment Results',
        ids: ['crb_result', 'ntsa_result'],
        emptyText: 'No CRB or NTSA results attached.'
      }
    ];

    const renderCard = d => {
      const rawLabel = d.label || d.name || 'Supporting document';
      const label = this.escapeHtml(rawLabel
        .replace(/National ID Front & Back/i, 'National ID (Front & Back)')
        .replace(/6-Month /i, '6-month '));
      const name = this.escapeHtml(d.name || 'Uploaded document');
      const type = String(d.type || '').toLowerCase();
      const isImage = type.startsWith('image/');
      const icon = isImage ? 'ti-photo' : type.includes('pdf') ? 'ti-file-type-pdf' : 'ti-file-check';
      const preview = appId
        ? `LOSModule.previewAppDoc('${this.escapeHtml(appId)}', '${this.escapeHtml(d.id || '')}')`
        : `LOSModule.previewIntakeDoc('${this.escapeHtml(d.id || '')}')`;
      const thumbnail = isImage && d.dataUrl
        ? `<img src="${this.escapeHtml(d.dataUrl)}" alt="${label}" class="kyc-document-thumb">`
        : `<div class="kyc-document-placeholder"><i class="ti ${icon}"></i><span>${type.includes('pdf') ? 'PDF document' : 'Document preview'}</span></div>`;

      return `
        <div class="kyc-document-card${isImage && d.dataUrl ? ' kyc-document-card--image' : ''}">
          <div class="kyc-document-preview">${thumbnail}</div>
          <div class="kyc-document-label"><i class="ti ti-circle-check"></i> ${label} uploaded</div>
          <div class="kyc-document-name" title="${name}">${name}</div>
          <button type="button" class="btn btn-sm kyc-preview-btn" onclick="${preview}">
            <i class="ti ti-eye"></i> Preview
          </button>
        </div>`;
    };

    const renderedGroups = groups.map(group => {
      const groupDocs = docs.filter(d => group.ids.includes(d.id));
      if (!groupDocs.length) return '';
      return `
        <div class="kyc-document-group ${group.title.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '')}">
          <div class="kyc-document-group-title">${group.title}</div>
          <div class="kyc-document-grid">${groupDocs.map(renderCard).join('')}</div>
        </div>`;
    }).join('');

    const knownIds = groups.flatMap(group => group.ids);
    const otherDocs = docs.filter(d => !knownIds.includes(d.id));
    return `${renderedGroups}${otherDocs.length ? `
      <div class="kyc-document-group">
        <div class="kyc-document-group-title">Supporting Documents</div>
        <div class="kyc-document-grid">${otherDocs.map(renderCard).join('')}</div>
      </div>` : ''}`;
  },

  renderInteractionLog(application, loan = null) {
    const activeRole = DataStore.get().activeRole;
    if (['SUPER_ADMIN', 'OVERALL_ADMIN'].includes(activeRole)) return '';

    const entries = Array.isArray(application?.interactions) ? [...application.interactions] : [];
    (loan?.interactions || []).forEach(entry => {
      if (!entries.some(existing => existing.id && existing.id === entry.id)) entries.push(entry);
    });
    const appId = application?.id || loan?.appId || '';
    const accountNumber = loan?.accountNumber || '';
    const esc = value => this.escapeHtml(value);
    const history = entries.length
      ? [...entries].reverse().map(entry => `
        <div style="padding:12px 0;border-bottom:1px solid var(--border-light)">
          <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap">
            <div style="font-weight:700;color:#172033">${esc(entry.type)} · ${esc(entry.summary)}</div>
            <span style="font:11px var(--font-mono);color:#64748B;white-space:nowrap">${esc(entry.at)}</span>
          </div>
          <div style="font-size:11px;color:#64748B;margin:4px 0 7px">Captured by ${esc(entry.by)} · Stage: ${esc(entry.stage || '—')}</div>
          <div style="font-size:12px;line-height:1.55;white-space:pre-wrap">${esc(entry.notes)}</div>
        </div>`).join('')
      : `<div style="border:1px dashed #172033;border-radius:8px;padding:20px;text-align:center;color:#475467;font-size:12px;font-style:italic">No client interactions captured for this file yet. Document client outreach below.</div>`;

    return `
      <div class="card" style="border:1px solid #E2E8F0">
        <div class="card-header">
          <div class="card-title-group">
            <i class="ti ti-message" style="font-size:17px;color:#F04400"></i>
            <span class="card-title">Customer &amp; Staff Interactions Log</span>
          </div>
          <span class="badge" style="background:#F8FAFC;color:#64748B;font-family:var(--font-mono)">${entries.length} recorded</span>
        </div>
        <div class="card-body">
          <p style="font-size:12px;line-height:1.55;margin:0 0 14px">Log client phone conversations, site inspections, verification outcomes, and critical notifications sent from your seat. This establishes a physical auditable file trail.</p>
          ${history}
          <div style="border-top:1px solid var(--border-light);margin-top:14px;padding-top:14px">
            <div class="section-label" style="margin:0 0 12px">Capture New Official Interaction</div>
            <div style="display:grid;grid-template-columns:minmax(220px,1fr) minmax(280px,2fr);gap:12px">
              <div class="fg" style="margin:0">
                <label for="interaction-type">Interaction Type <span style="color:#DC2626">*</span></label>
                <select id="interaction-type" required>
                  <option value="">Select interaction type…</option>
                  <option value="Contact via Phone Call">📞 Contact via Phone Call</option>
                  <option value="Site Inspection">📍 Site Inspection</option>
                  <option value="Customer Meeting">🤝 Customer Meeting</option>
                  <option value="Verification Outcome">✓ Verification Outcome</option>
                  <option value="Critical Notification">🔔 Critical Notification</option>
                  <option value="Staff / Internal Discussion">👥 Staff / Internal Discussion</option>
                  <option value="Other Official Interaction">📝 Other Official Interaction</option>
                </select>
              </div>
              <div class="fg" style="margin:0">
                <label for="interaction-summary">Core Summary / Headline <span style="color:#DC2626">*</span></label>
                <input id="interaction-summary" type="text" maxlength="180" required placeholder="e.g. Verified logbook registration details with NTSA; call with guarantor…">
              </div>
            </div>
            <div class="fg" style="margin:12px 0 0">
              <label for="interaction-notes">Detailed Discussion Notes &amp; Actionable Outcomes <span style="color:#DC2626">*</span></label>
              <textarea id="interaction-notes" rows="3" maxlength="3000" required placeholder="Record the direct outcomes of this conversation or official action, plus agreements and escalation actions…"></textarea>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-top:12px">
              <span style="font:11px var(--font-mono);color:#64748B">Capturing as: <strong>${esc(DataStore.get().roles?.[DataStore.get().activeRole]?.title || DataStore.get().activeRole)}</strong></span>
              <button type="button" class="btn btn-primary" onclick="LOSModule.saveInteraction('${esc(appId)}', '${esc(accountNumber)}')"><i class="ti ti-device-floppy"></i> Save Interaction Log</button>
            </div>
          </div>
        </div>
      </div>`;
  },

  saveInteraction(appId, accountNumber = '') {
    const data = DataStore.get();
    if (['SUPER_ADMIN', 'OVERALL_ADMIN'].includes(data.activeRole)) {
      alert('Your role cannot add entries to the Customer & Staff Interactions Log.');
      return;
    }
    const application = (data.applications || []).find(item => item.id === appId)
      || (data.applications || []).find(item => item.id === accountNumber);
    const loan = (data.loans || []).find(item => item.accountNumber === accountNumber)
      || (data.loans || []).find(item => item.appId === appId);
    const type = document.getElementById('interaction-type')?.value || '';
    const summary = (document.getElementById('interaction-summary')?.value || '').trim();
    const notes = (document.getElementById('interaction-notes')?.value || '').trim();
    if (!application && !loan) return;
    if (!type || !summary || !notes) {
      alert('Select an interaction type and enter both the summary and detailed notes.');
      return;
    }

    const now = new Date();
    const at = `${now.toISOString().slice(0, 10)} ${now.toTimeString().slice(0, 5)}`;
    const role = data.activeRole;
    const entry = {
      id: `INT-${now.getTime()}`,
      type,
      summary,
      notes,
      by: data.roles?.[role]?.title || role,
      role,
      at,
      stage: application?.status || loan?.status || '—'
    };
    if (application) {
      application.interactions = Array.isArray(application.interactions) ? application.interactions : [];
      application.interactions.push(entry);
      application.audit = Array.isArray(application.audit) ? application.audit : [];
      application.audit.unshift({
        interactionId: entry.id,
        action: `Customer/staff interaction logged (${type}): ${summary}`,
        by: entry.by,
        at
      });
    }
    if (loan) {
      loan.interactions = Array.isArray(loan.interactions) ? loan.interactions : [];
      loan.interactions.push({ ...entry });
    }
    const saved = DataStore.save(data);
    if (!saved) {
      if (application) {
        application.interactions = application.interactions.filter(item => item.id !== entry.id);
        application.audit = application.audit.filter(item => item.interactionId !== entry.id);
      }
      if (loan) loan.interactions = loan.interactions.filter(item => item.id !== entry.id);
      alert('Interaction log could not be saved in this browser. Free storage space and try again.');
      return;
    }
    if (loan && App.currentTab === 'loan-detail') LMSModule.openLoan360(loan.accountNumber);
    else if (application) this.openApplicationDetail(application.id);
  },

  renderConditionEvidenceCards(conditions, appId) {
    const docs = (Array.isArray(conditions) ? conditions : [])
      .filter(c => c?.evidence && c?.evidenceDocument);
    if (!docs.length) return '';

    const groups = [
      { title: '1. Customer KYC Files', test: label => /home|residence|personal guarantee|spouse|partner|corporate guarantee|board resolution/i.test(label) },
      { title: '2. Facility Application Documents', test: label => !/home|residence|personal guarantee|spouse|partner|corporate guarantee|board resolution|logbook|ntsa|gps|tracker|insurance|caveat/i.test(label) },
      { title: '3. Asset Logbook Documents', test: label => /logbook|ntsa|gps|tracker|insurance|caveat/i.test(label) }
    ];

    const renderCard = condition => {
      const doc = condition.evidenceDocument;
      const label = this.escapeHtml(condition.label || 'Supporting document');
      const name = this.escapeHtml(doc.name || condition.evidence || 'Uploaded document');
      const type = String(doc.type || '').toLowerCase();
      const isImage = type.startsWith('image/');
      const icon = type.includes('pdf') ? 'ti-file-type-pdf' : isImage ? 'ti-photo' : 'ti-file-check';
      const preview = `LOSModule.previewConditionEvidence('${this.escapeHtml(appId)}', '${this.escapeHtml(condition.id)}')`;
      const thumbnail = isImage && doc.dataUrl
        ? `<img src="${this.escapeHtml(doc.dataUrl)}" alt="${label}" class="kyc-document-thumb">`
        : `<div class="kyc-document-placeholder"><i class="ti ${icon}"></i><span>${type.includes('pdf') ? 'PDF document' : 'Document preview'}</span></div>`;
      const status = condition.isMet ? 'verified' : 'uploaded';

      return `
        <div class="kyc-document-card cp-evidence-card">
          <div class="kyc-document-preview">${thumbnail}</div>
          <div class="kyc-document-label"><i class="ti ti-circle-check"></i> ${label} ${status}</div>
          <div class="kyc-document-name" title="${name}">${name}</div>
          <button type="button" class="btn btn-sm kyc-preview-btn" onclick="${preview}">
            <i class="ti ti-eye"></i> Preview
          </button>
        </div>`;
    };

    const renderedGroups = groups.map(group => {
      const groupDocs = docs.filter(c => group.test(c.label || ''));
      if (!groupDocs.length) return '';
      return `
        <div class="kyc-document-group">
          <div class="kyc-document-group-title">${group.title}</div>
          <div class="kyc-document-grid cp-evidence-grid">${groupDocs.map(renderCard).join('')}</div>
        </div>`;
    }).join('');

    return `
      <div class="cp-evidence-heading"><i class="ti ti-file-check"></i> 3. Attached Assessment &amp; Verification Documents</div>
      ${renderedGroups}`;
  },

  formatBytes(n) {
    const size = Number(n) || 0;
    if (size < 1024) return `${size} B`;
    if (size < 1048576) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / 1048576).toFixed(1)} MB`;
  },

  formatAmountInput(input) {
    if (!input) return;
    const raw = String(input.value || '').replace(/[^0-9]/g, '');
    input.value = raw ? Number(raw).toLocaleString('en-US') : '';
  },

  readAmount(id) {
    const value = document.getElementById(id)?.value || '';
    const parsed = Number(String(value).replace(/,/g, '').trim());
    return Number.isFinite(parsed) ? parsed : 0;
  },

  initDocSlots() {
    this.renderProductKycDocSlots();
    this.getDocSlots().forEach(slot => this.renderDocSlot(slot.id));
    const passwordInput = document.getElementById('mpesa-statement-password');
    if (passwordInput) passwordInput.value = this.intakeDocs.mpesa_statement?.password || '';
    this.bindDocDropzones();
  },

  captureMpesaStatementPassword(value) {
    if (!this.canCreateApplication()) return;
    if (this.intakeDocs.mpesa_statement) this.intakeDocs.mpesa_statement.password = String(value || '');
    this.saveDraft();
  },

  renderDocSlot(id) {
    const slot = this.docSlot(id);
    const box = document.getElementById(`doc-box-${id}`);
    const inner = document.getElementById(`doc-inner-${id}`);
    if (!box || !inner) return;

    const file = this.intakeDocs[id];
    if (!file) {
      box.classList.remove('uploaded');
      const captureLabel = id === 'id_front' ? 'Capture Front ID' : id === 'id_back' ? 'Capture Back ID' : '';
      inner.innerHTML = `
        <i class="ti ti-cloud-upload" style="font-size:22px;display:block;margin-bottom:6px"></i>
        <strong>${slot.label}</strong>
        <span class="upload-hint">Click or drop PDF, JPG, PNG or WEBP · max 5 MB</span>
        ${captureLabel ? `<button type="button" class="btn btn-sm btn-primary" style="margin-top:8px" onclick="event.stopPropagation();LOSModule.openDocPicker(null, '${id}')"><i class="ti ti-camera"></i> ${captureLabel}</button>` : ''}
      `;
      return;
    }

    box.classList.add('uploaded');
    const isImg = (file.type || '').startsWith('image/');
    inner.innerHTML = `
      ${isImg && file.dataUrl
        ? `<img class="upload-thumb" src="${file.dataUrl}" alt="">`
        : `<i class="ti ti-file-check" style="color:#059669;font-size:22px;display:block;margin-bottom:6px"></i>`}
      <strong>${slot.label} uploaded</strong>
      <span class="upload-hint">${file.name} · ${this.formatBytes(file.size)}</span>
      <div class="upload-actions">
        <button type="button" class="btn btn-sm" onclick="event.stopPropagation();LOSModule.previewIntakeDoc('${id}')">
          <i class="ti ti-eye"></i> Preview
        </button>
        <button type="button" class="btn btn-sm" onclick="event.stopPropagation();LOSModule.openDocPicker(event, '${id}')">
          <i class="ti ti-refresh"></i> Replace
        </button>
        <button type="button" class="btn btn-sm" onclick="event.stopPropagation();LOSModule.removeIntakeDoc('${id}')">
          <i class="ti ti-x"></i> Remove
        </button>
      </div>
    `;
  },

  bindDocDropzones() {
    document.querySelectorAll('#step-4 .upload-box').forEach(box => {
      if (box.dataset.bound === '1') return;
      box.dataset.bound = '1';
      box.addEventListener('dragover', e => {
        e.preventDefault();
        box.classList.add('dragover');
      });
      box.addEventListener('dragleave', () => box.classList.remove('dragover'));
      box.addEventListener('drop', e => {
        e.preventDefault();
        box.classList.remove('dragover');
        const id = box.dataset.docId;
        const file = e.dataTransfer?.files?.[0];
        if (id && file) this.readIntakeFile(id, file);
      });
    });
  },

  openDocPicker(event, id) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
      if (event.target?.closest && event.target.closest('button') && !event.target.closest('.upload-actions')) return;
    }
    const input = document.getElementById(`file-${id}`);
    if (input) {
      input.value = '';
      input.click();
    }
  },

  handleDocUpload(event, id) {
    const file = event.target?.files?.[0];
    if (!file) return;
    this.readIntakeFile(id, file, event.target);
  },

  isAllowedDoc(file) {
    if (!file) return false;
    const type = (file.type || '').toLowerCase().trim();
    const name = String(file.name || '').trim();
    const isPdf = type === 'application/pdf'
      || type.startsWith('application/pdf;')
      || /\.pdf$/i.test(name);
    const allowedImages = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    return isPdf || allowedImages.includes(type) || /\.(jpe?g|png|webp)$/i.test(name);
  },

  readIntakeFile(id, file, input) {
    if (!this.isAllowedDoc(file)) {
      alert('Please upload a PDF or image (JPG, PNG, WEBP).');
      if (input) input.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert('File is too large. Maximum size is 5 MB.');
      if (input) input.value = '';
      return;
    }

    const slot = this.docSlot(id);
    const reader = new FileReader();
    reader.onload = () => {
      this.intakeDocs[id] = {
        id,
        label: slot.label,
        name: file.name,
        type: (/\.pdf$/i.test(file.name || '') || (file.type || '').toLowerCase() === 'application/pdf')
          ? 'application/pdf'
          : (file.type || 'image/jpeg'),
        size: file.size,
        dataUrl: reader.result,
        uploadedAt: new Date().toISOString(),
        ...(id === 'mpesa_statement' && document.getElementById('mpesa-statement-password')?.value
          ? { password: document.getElementById('mpesa-statement-password').value }
          : {})
      };
      this.renderDocSlot(id);
    };
    reader.onerror = () => {
      alert('Could not read that file. Please try another copy.');
      if (input) input.value = '';
    };
    reader.readAsDataURL(file);
  },

  removeIntakeDoc(id) {
    delete this.intakeDocs[id];
    const input = document.getElementById(`file-${id}`);
    if (input) input.value = '';
    this.renderDocSlot(id);
  },

  snapshotIntakeDocs(withData) {
    const mpesaPassword = document.getElementById('mpesa-statement-password')?.value || '';
    if (this.intakeDocs.mpesa_statement) this.intakeDocs.mpesa_statement.password = mpesaPassword;
    return this.getDocSlots().map(s => this.intakeDocs[s.id]).filter(Boolean).map(d => ({
      id: d.id,
      label: d.label,
      name: d.name,
      type: d.type,
      size: d.size,
      uploadedAt: d.uploadedAt,
      ...(d.id === 'mpesa_statement' && d.password ? { password: d.password } : {}),
      dataUrl: withData === false ? '' : d.dataUrl
    }));
  },

  _base64ToBlobUrl(dataUrl, mimeType) {
    if (!dataUrl || typeof dataUrl !== 'string') return '';
    const comma = dataUrl.indexOf(',');
    if (comma === -1) return dataUrl;
    try {
      const base64 = dataUrl.slice(comma + 1);
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
    } catch (err) {
      console.warn('Failed to convert data URL to blob', err);
      return dataUrl;
    }
  },

  previewIntakeDoc(id) {
    this.openDocPreview(this.intakeDocs[id]);
  },

  previewAppDoc(appId, docId) {
    const application = (DataStore.get().applications || []).find(item => item.id === appId);
    const storedDoc = (application?.documents || []).find(item => item.id === docId);
    const resultDoc = docId === 'crb_result' ? application?.crbResult
      : docId === 'ntsa_result' ? application?.ntsaResult : null;
    let cached = this._docCache[appId]?.find(item => item.id === docId && item.dataUrl);
    if (!cached?.dataUrl) {
      try {
        const raw = sessionStorage.getItem(`SPECTRUM_DOC_CACHE_${appId}`);
        if (raw) {
          const docs = JSON.parse(raw);
          cached = docs.find(item => item.id === docId && item.dataUrl);
          if (cached) {
            this._docCache[appId] = this._docCache[appId] || [];
            this._docCache[appId] = this._docCache[appId].filter(item => item.id !== docId);
            this._docCache[appId].push(cached);
          }
        }
      } catch (error) {
        console.warn('Could not restore document cache from sessionStorage', error);
      }
    }
    // Session cache entries may contain only id/dataUrl; preserve the saved
    // filename and MIME type so the preview can identify images and PDFs.
    const metadata = storedDoc || resultDoc || {};
    const doc = {
      ...metadata,
      ...cached,
      type: metadata.type || cached?.type || this.inferDocumentType(metadata.name, cached?.dataUrl),
      name: metadata.name || cached?.name || metadata.label || 'Supporting document',
      label: metadata.label || cached?.label || metadata.name || 'Supporting document'
    };
    this.openDocPreview(doc);
  },

  inferDocumentType(name = '', dataUrl = '') {
    const fromData = String(dataUrl || '').match(/^data:([^;,]+)/i)?.[1];
    if (fromData) return fromData.toLowerCase();
    const filename = String(name || '').toLowerCase();
    if (/\.pdf(?:$|[?#])/.test(filename)) return 'application/pdf';
    if (/\.png(?:$|[?#])/.test(filename)) return 'image/png';
    if (/\.webp(?:$|[?#])/.test(filename)) return 'image/webp';
    if (/\.jpe?g(?:$|[?#])/.test(filename)) return 'image/jpeg';
    return '';
  },

  openDocPreview(doc) {
    if (!doc) return;
    if (doc.id === 'mpesa_statement' && doc.password) {
      const enteredPassword = window.prompt('Enter the captured M-Pesa statement password to preview this document:');
      if (enteredPassword === null) return;
      if (enteredPassword !== String(doc.password)) {
        alert('The M-Pesa statement password is incorrect.');
        return;
      }
    }
    const modal = document.getElementById('offer-letter-modal');
    const content = document.getElementById('offer-letter-content');
    const title = modal?.querySelector('.modal-title');
    if (!modal || !content) {
      alert(doc.name || doc.label || 'Document');
      return;
    }
    if (title) title.innerHTML = `<i class="ti ti-file-search"></i> ${doc.label || doc.name}`;
    let src = doc.dataUrl || '';
    let downloadSrc = src;
    if (this._pdfPreviewUrl) {
      URL.revokeObjectURL(this._pdfPreviewUrl);
      this._pdfPreviewUrl = null;
    }
    if (this._htmlPreviewUrl) {
      URL.revokeObjectURL(this._htmlPreviewUrl);
      this._htmlPreviewUrl = null;
    }
    const isPdfDocument = (doc.type || '').toLowerCase() === 'application/pdf'
      || /\.pdf(?:$|[?#])/i.test(doc.name || '')
      || String(src || '').toLowerCase().startsWith('data:application/pdf')
      || /^data:[^;]*;base64,/i.test(src || '') && /%PDF-/.test(atob(String(src).slice(src.indexOf(',') + 1) || '').slice(0, 8));
    if (isPdfDocument) {
      // Always convert PDF data URLs into a Blob object URL. This sidesteps
      // browser sandbox/blank-frame problems with data: PDFs and gives the
      // download link a working href.
      try {
        let base64 = '';
        if (/^data:[^;]*;base64,/i.test(src || '')) {
          base64 = src.slice(src.indexOf(',') + 1);
        } else if (String(src).startsWith('data:')) {
          base64 = src.slice(src.indexOf(',') + 1);
        }
        if (base64) {
          const binary = atob(base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          this._pdfPreviewUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
          src = this._pdfPreviewUrl;
          downloadSrc = this._pdfPreviewUrl;
        }
      } catch (error) {
        console.warn('Could not prepare PDF preview source', error);
      }
    }
    if (!src) {
      content.innerHTML = `
        <div class="alert alert-info" style="margin:0">
          <i class="ti ti-info-circle"></i>
          <span><strong>${doc.name || doc.label}</strong> is on this file (${this.formatBytes(doc.size)}), but the binary is not stored for preview in this browser session.</span>
        </div>`;
    } else if ((doc.type || '').startsWith('image/')) {
      content.innerHTML = `<img src="${src}" alt="${doc.name || ''}" style="max-width:100%;border-radius:8px;display:block;margin:0 auto">`;
    } else {
      const safeName = doc.name || doc.label || 'Document';
      const normalizedType = (doc.type || '').toLowerCase();
      const isHtml = normalizedType.startsWith('text/html')
        || /\.html?(?:$|[?#])/i.test(safeName)
        || String(src).toLowerCase().startsWith('data:text/html');
      const isPdf = normalizedType === 'application/pdf'
        || /\.pdf(?:$|[?#])/i.test(safeName)
        || String(src).toLowerCase().startsWith('data:application/pdf')
        || /\.pdf$/i.test(safeName)
        || !!this._pdfPreviewUrl;

      if (isHtml) {
        // Load the original data/blob URL directly. This avoids srcdoc escaping
        // failures and supports generated undertaking Blob URLs reliably.
        content.innerHTML = `
          <div style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:8px">
            <strong style="font-size:12px;overflow:hidden;text-overflow:ellipsis">${safeName}</strong>
            <a class="btn btn-sm btn-primary" href="${src}" target="_blank" rel="noopener" download="${safeName}">
              <i class="ti ti-download"></i> Download Undertaking
            </a>
          </div>
          <iframe class="doc-html-frame" src="${src}" title="${safeName}"
            style="display:block;width:100%;height:70vh;min-height:480px;border:1px solid var(--border-light);border-radius:8px;background:#FFF"
            loading="eager"></iframe>`;
      } else if (!isPdf) {
        content.innerHTML = `
          <div class="alert alert-info" style="margin:0">
            <i class="ti ti-info-circle"></i>
            <span>This file type cannot be displayed inline. <a href="${src}" target="_blank" rel="noopener" download="${safeName}">Open or download the file</a>.</span>
          </div>`;
      } else {
        content.innerHTML = `
          <div style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:8px">
            <strong style="font-size:12px;overflow:hidden;text-overflow:ellipsis">${safeName}</strong>
            <a class="btn btn-sm btn-primary" href="${downloadSrc}" target="_blank" rel="noopener" download="${safeName}">
              <i class="ti ti-download"></i> Download PDF
            </a>
          </div>
          <iframe class="doc-pdf-frame" src="${src}#toolbar=1&navpanes=0&view=FitH" title="${safeName}"
            style="display:block;width:100%;height:70vh;min-height:480px;border:1px solid var(--border-light);border-radius:8px;background:#F8FAFC"
            loading="eager"></iframe>
          <div class="alert alert-info" style="margin:10px 0 0">
            <i class="ti ti-info-circle"></i>
            <span>If the embedded viewer is blank, use <a href="${downloadSrc}" target="_blank" rel="noopener">Open PDF in a new tab</a> or <a href="${downloadSrc}" download="${safeName}">download it</a>.</span>
          </div>`;
      }
    }
    modal.classList.add('active');
  },

  normalizeCustomerIdentifier(value, type) {
    const normalized = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (type !== 'phone') return normalized;

    let digits = normalized.replace(/\D/g, '');
    if (digits.startsWith('0')) digits = `254${digits.slice(1)}`;
    else if (digits.length === 9 && /^[17]/.test(digits)) digits = `254${digits}`;
    return digits;
  },

  validateUniqueCustomerIdentifiers() {
    const identifiers = [
      { label: 'Mobile Phone Number (M-Pesa registered)', id: 'n-phone', type: 'phone', keys: ['phone', 'mobile', 'mobilePhone', 'mpesaPhone'] },
      { label: 'KRA PIN', id: 'n-kra', type: 'text', keys: ['kraPin', 'kra', 'clientKraPin'] },
      { label: 'National ID / Passport Number', id: 'n-id', type: 'text', keys: ['idNumber', 'nationalId', 'nationalIdNumber', 'passportNumber'] }
    ];
    const data = DataStore.get();
    const records = [
      ...(data.applications || []),
      ...(data.loans || []).filter(loan => !(data.applications || []).some(app => app.id === loan.appId))
    ];

    for (const identifier of identifiers) {
      const value = this.normalizeCustomerIdentifier(document.getElementById(identifier.id)?.value, identifier.type);
      if (!value) continue;

      const duplicate = records.find(record => identifier.keys.some(key =>
        this.normalizeCustomerIdentifier(record[key], identifier.type) === value
      ));
      if (duplicate) {
        alert(`${identifier.label} is already registered on ${duplicate.id || duplicate.accountNumber || 'another customer record'}. Each customer must have a unique identifier.`);
        this.goStep(1);
        document.getElementById(identifier.id)?.focus();
        return false;
      }
    }
    return true;
  },

  // Switch intake wizard steps
  goStep(n) {
    if (n > 1 && !this.validateUniqueCustomerIdentifiers()) return;
    this.currentStep = n;
    for (let i = 1; i <= 5; i++) {
      const stepEl = document.getElementById(`step-${i}`);
      const tabEl = document.getElementById(`step-tab-${i}`);
      if (stepEl) stepEl.style.display = i === n ? 'block' : 'none';
      if (tabEl) {
        tabEl.className = 'stage-step ' + (i < n ? 'done' : i === n ? 'active' : 'pending');
      }
    }
    if (n === 2) {
      this.populateProductSelect();
      this.toggleLoanType();
      this.updateLoanPreview();
    }
    if (n === 4) this.initDocSlots();
    if (n === 5) this.buildReviewSummary();
  },

  toggleBizFields() {
    const isBiz = document.querySelector('input[name="cust-type"]:checked')?.value === 'BUSINESS';
    const bizBox = document.getElementById('biz-fields');
    if (bizBox) bizBox.style.display = isBiz ? 'block' : 'none';
  },

  toggleLoanType() {
    const loanType = document.getElementById('n-loan-type')?.value || 'ASSET_FINANCE';
    const buyoffBox = document.getElementById('buyoff-fields');
    const assetBox = document.getElementById('asset-finance-fields');
    if (buyoffBox) buyoffBox.style.display = loanType === 'BUY_OFF' ? 'block' : 'none';
    if (assetBox) assetBox.style.display = loanType === 'ASSET_FINANCE' ? 'block' : 'none';

    const required = loanType === 'BUY_OFF'
      ? ['n-buyoff-company', 'n-buyoff-address', 'n-buyoff-town', 'n-buyoff-client', 'n-buyoff-reg', 'n-buyoff-id', 'n-buyoff-kra']
      : loanType === 'ASSET_FINANCE'
        ? ['n-seller-name', 'n-seller-address', 'n-seller-town', 'n-asset-client', 'n-asset-kra']
        : [];
    [...document.querySelectorAll('#buyoff-fields input, #asset-finance-fields input')].forEach(input => {
      input.required = required.includes(input.id);
    });
    this.updateLoanPreview();
  },

  validateFacilityTypeDetails(terms) {
    // Straight Loans do not require Buy-off or Asset Finance transaction details.
    if (terms.loanType === 'STRAIGHT_LOAN') return true;

    const fields = terms.loanType === 'BUY_OFF'
      ? [
        ['Company Name', terms.buyoffDetails.companyName],
        ['Address', terms.buyoffDetails.address],
        ['Town', terms.buyoffDetails.town],
        ['Client Names', terms.buyoffDetails.clientNames],
        ['Motor Vehicle Registration No.', terms.buyoffDetails.vehicleReg],
        ['ID Number', terms.buyoffDetails.idNumber],
        ['KRA PIN', terms.buyoffDetails.kraPin]
      ]
      : [
        ['Seller Name', terms.assetFinanceDetails.sellerName],
        ['Seller Address as per KRA', terms.assetFinanceDetails.sellerAddress],
        ['Seller Town', terms.assetFinanceDetails.sellerTown],
        ['Client Name', terms.assetFinanceDetails.clientName],
        ['Client KRA PIN', terms.assetFinanceDetails.clientKraPin]
      ];
    const missing = fields.filter(([, value]) => !String(value || '').trim()).map(([label]) => label);
    if (missing.length) {
      alert(`Complete the ${terms.loanType === 'BUY_OFF' ? 'Buy-off' : 'Asset Finance'} details: ${missing.join(', ')}.`);
      this.goStep(2);
      return false;
    }
    return true;
  },

  isInsuranceExcludedFacility(application) {
    // All current facility types, including Buy-off, may carry an uploaded
    // insurance debit note. The debit-note allocation is therefore included
    // in the offer letter and repayment schedule whenever a note is present.
    // Keep this method for compatibility with older saved records and callers.
    return false;
  },

  insuranceAllocation(application) {
    const note = application?.insuranceDebitNote;
    const amount = Number(note?.amount) || 0;
    if (!(amount > 0)) return null;
    const feePortion = amount / 3;
    const remainingAmount = amount - feePortion;
    const monthOneAddition = remainingAmount / 2;
    const monthTwoAddition = remainingAmount / 2;
    return {
      amount,
      feePortion,
      remainingAmount,
      monthOneAddition,
      monthTwoAddition,
      totalAllocated: feePortion + monthOneAddition + monthTwoAddition
    };
  },

  applyInsuranceToQuote(quote, application) {
    const allocation = this.insuranceAllocation(application);
    if (!quote || !allocation || this.isInsuranceExcludedFacility(application)) return quote;
    const schedule = quote.schedule.map(row => ({ ...row }));
    schedule.forEach(row => {
      const addition = row.n === 1 ? allocation.monthOneAddition : row.n === 2 ? allocation.monthTwoAddition : 0;
      const futureInsurance = row.n === 1
        ? allocation.monthOneAddition + allocation.monthTwoAddition
        : row.n === 2 ? allocation.monthTwoAddition : 0;
      row.insuranceAddition = addition;
      row.installment += addition;
      row.remainingPayable += futureInsurance;
    });
    return {
      ...quote,
      schedule,
      insuranceAllocation: allocation,
      totalPayable: quote.totalPayable + allocation.monthOneAddition + allocation.monthTwoAddition,
      insuranceMonthOne: allocation.monthOneAddition,
      insuranceMonthTwo: allocation.monthTwoAddition
    };
  },

  loanTypeLabel(loanType) {
    return {
      STRAIGHT_LOAN: 'Straight Loan',
      ASSET_FINANCE: 'Asset Finance',
      BUY_OFF: 'Buy-off'
    }[loanType] || 'Straight Loan';
  },

  undertakingDetails(application) {
    const type = application?.loanType === 'BUY_OFF' ? 'BUY_OFF' : 'ASSET_FINANCE';
    return {
      type,
      title: type === 'BUY_OFF' ? 'BUY-OFF UNDERTAKING' : 'ASSET FINANCE UNDERTAKING',
      applicationId: application?.id || '',
      customer: application?.customer || '',
      amount: Number(application?.amount) || 0,
      details: type === 'BUY_OFF' ? (application.buyoffDetails || {}) : (application.assetFinanceDetails || {})
    };
  },

  generateUndertaking(applicationId) {
    const data = DataStore.get();
    if (data.activeRole !== 'RISK_OFFICER') {
      alert('Only the Risk Officer can generate undertakings.');
      return;
    }
    const application = (data.applications || []).find(item => item.id === applicationId);
    if (!application || !['BUY_OFF', 'ASSET_FINANCE'].includes(application.loanType)) {
      alert('This application has no Buy-off or Asset Finance undertaking details.');
      return;
    }

    const u = this.undertakingDetails(application);
    const d = u.details || {};
    const esc = value => this.escapeHtml(value || '—');
    const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
    const isBuyOff = u.type === 'BUY_OFF';
    const recipient = isBuyOff ? d.companyName : d.sellerName;
    const address = isBuyOff ? d.address : d.sellerAddress;
    const town = isBuyOff ? d.town : d.sellerTown;
    const client = isBuyOff ? d.clientNames : d.clientName;
    const vehicleReg = isBuyOff ? d.vehicleReg : application.reg;
    const clientPin = isBuyOff ? d.kraPin : d.clientKraPin;

    const detailRows = isBuyOff
      ? [
        ['Client name(s)', client],
        ['National ID number', d.idNumber],
        ['Client KRA PIN', clientPin],
        ['Motor vehicle registration', vehicleReg],
        ['Buy-off company', recipient],
        ['Company address', address],
        ['Company town', town]
      ]
      : [
        ['Client name', client],
        ['Client KRA PIN', clientPin],
        ['Seller name', recipient],
        ['Seller address as per KRA', address],
        ['Seller town', town],
        ['Asset / vehicle registration', vehicleReg]
      ];

    const borrowerId = d.clientIdNumber || application.idNumber || application.nationalId || '';
    const assetVehicleReg = d.vehicleReg || application.reg || '';
    const chassisNumber = d.chassisNumber || application.chassisNumber || application.chassis || '';
    const engineNumber = d.engineNumber || application.engineNumber || application.engine || '';
    const assetClientPin = d.clientKraPin || application.kraPin || '';
    const undertakingText = isBuyOff
      ? `We hereby undertake to settle the outstanding amount due to ${esc(recipient)} in respect of the buy-off of the motor vehicle identified below, subject to the approved facility terms and completion of the required transfer, discharge and security documentation.`
      : `We refer to the above matter. Spectrum Credit Limited is offering an Asset Finance facility to ${esc(client)} with the intention of paying off the outstanding balance with your company.`;

    const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(u.title)} - ${esc(application.id)}</title>
<style>
@page{size:A4;margin:20mm}body{font:13px Arial,sans-serif;color:#172033;line-height:1.55;margin:0}header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #0b5d8a;padding-bottom:14px;margin-bottom:24px}.brand{font-size:20px;font-weight:800;color:#0b5d8a;letter-spacing:.3px}.meta{text-align:right;font-size:12px}.title{text-align:center;font-size:18px;font-weight:800;text-decoration:underline;margin:22px 0}.recipient{margin:18px 0}.subject{font-weight:800;text-transform:uppercase;margin:22px 0 12px}.row{display:grid;grid-template-columns:38% 62%;border-bottom:1px solid #d9e0e7;padding:7px 0}.label{font-weight:700;color:#475467}.value{font-weight:500}.box{border:1px solid #b8c4d0;padding:12px;margin:18px 0}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:45px;margin-top:70px}.signature{border-top:1px solid #172033;padding-top:8px;min-height:45px}.small{font-size:11px;color:#667085}.footer{margin-top:45px;border-top:1px solid #d9e0e7;padding-top:8px;font-size:10px;color:#667085}
</style></head><body>
<header><div><div class="brand">SPECTRUM CREDIT LIMITED</div><div class="small">Logbook-backed lending and asset finance</div></div><div class="meta">Date: <b>${esc(today)}</b><br>Reference: <b>${esc(application.id)}</b></div></header>
<div class="title">${esc(u.title)}</div>
<div class="recipient"><b>To:</b><br>${esc(recipient)}<br>${esc(address)}<br>${esc(town)}</div>
<div class="subject">RE: ${isBuyOff ? 'UNDERTAKING TO BUY OFF MOTOR VEHICLE FACILITY' : `ASSET FINANCE FOR ${esc(client)} OF ID NO: ${esc(borrowerId)}, REG NO: ${esc(assetVehicleReg)}, CHASSIS NUMBER: ${esc(chassisNumber)} AND ENGINE NUMBER: ${esc(engineNumber)}`}</div>
<p>Dear ${isBuyOff ? 'Sir/Madam' : 'Sir'},</p>
<p>${undertakingText}</p>
${isBuyOff ? `
<div class="box"><div class="subject" style="margin:0 0 8px">Facility and transaction details</div>
<div class="row"><span class="label">Application reference</span><span class="value">${esc(application.id)}</span></div>
<div class="row"><span class="label">Borrower / client</span><span class="value">${esc(client)}</span></div>
<div class="row"><span class="label">Approved facility amount</span><span class="value">${esc(FinEngine.kes(u.amount))}</span></div>
${detailRows.map(([label, value]) => `<div class="row"><span class="label">${esc(label)}</span><span class="value">${esc(value)}</span></div>`).join('')}
</div>
<p>Upon disbursement and subject to the applicable facility conditions, Spectrum Credit Limited shall process the transaction in accordance with its approved credit, compliance and security procedures. The recipient is requested to provide any supporting clearance, ownership, transfer and settlement documents required to complete the transaction.</p>
<p>This undertaking is issued for the above transaction only and does not vary the terms of the facility agreement, offer letter or any other security document executed by the parties.</p>
<p>Yours faithfully,</p>
<div class="signatures"><div class="signature"><b>For: Spectrum Credit Limited</b><br><br>Name: __________________________<br>Designation: Risk Officer<br>Date: __________________________</div><div class="signature"><b>Acknowledged by ${esc(recipient)}</b><br><br>Name: __________________________<br>Signature / Stamp: ______________<br>Date: __________________________</div></div>` : `
<p>Kindly let us have the following:</p>
<ol>
<li>The original logbook for motor vehicle registration number ${esc(assetVehicleReg)}.</li>
<li>Confirmation of the outstanding balance.</li>
<li>Your account details for settlement.</li>
<li>Transfer of the logbook through NTSA TIMS into the joint names of ${esc(client)}, PIN ${esc(assetClientPin)}, and Spectrum Credit Limited, PIN P051409022Y. Our collector's ID number is 41460799.</li>
<li>Your undertaking to release the original logbook upon settlement.</li>
</ol>
<p>We confirm that, save for the purpose of discharging your interest and simultaneously transferring the vehicle into the joint names stated above, we will not release the security documents received from you to any person before payment of the outstanding balance without first obtaining your written consent.</p>
<p>Yours faithfully,<br>For Spectrum Credit Limited.</p>
<div class="signatures"><div class="signature"><b>Opondo Otieno</b><br>Crispus Katana<br>Credit Risk Head of Credit Risk</div></div>`}
<div class="footer">System-generated undertaking · ${esc(application.id)} · ${esc(u.type.replace('_', ' '))}</div>
</body></html>`;

    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    this._undertakingDownloadUrl = url;
    const generatedAt = new Date().toISOString();
    application.undertaking = {
      ...u,
      recipient,
      generatedAt,
      name: `${u.type.toLowerCase()}-undertaking-${application.id}.html`
    };
    application.audit = Array.isArray(application.audit) ? application.audit : [];
    application.audit.unshift({
      action: `${u.title} generated for ${recipient || 'recipient'}`,
      by: 'Risk Officer',
      at: generatedAt.slice(0, 16).replace('T', ' ')
    });
    DataStore.save(data);

    const modal = document.getElementById('offer-letter-modal');
    const content = document.getElementById('offer-letter-content');
    if (modal && content) {
      content.innerHTML = `<div style="padding:16px"><div style="display:flex;justify-content:flex-end;margin-bottom:10px"><a class="btn btn-primary" href="${url}" download="${application.undertaking.name}"><i class="ti ti-download"></i> Download Undertaking</a></div><iframe class="doc-html-frame" src="${url}" title="${esc(u.title)}"></iframe></div>`;
      modal.classList.add('active');
    }
  },

  // Retain compatibility with older saved pages or inline handlers.
  toggleBuyoff() {
    const checkbox = document.getElementById('n-buyoff');
    const select = document.getElementById('n-loan-type');
    if (select) {
      select.value = checkbox?.checked ? 'BUY_OFF' : 'ASSET_FINANCE';
      this.toggleLoanType();
      return;
    }
    const box = document.getElementById('buyoff-fields');
    if (box) box.style.display = checkbox?.checked ? 'block' : 'none';
    this.updateLoanPreview();
  },

  populateProductSelect() {
    const sel = document.getElementById('n-product');
    if (!sel) return;
    const current = sel.value;
    const products = (DataStore.get().products || []).filter(p => p.status !== 'INACTIVE');
    sel.innerHTML = `<option value="">Select a credit product…</option>` + products.map(p => `
      <option value="${p.id}">${p.name} · ${p.defaultRate}% p.m. flat · max ${FinEngine.kes(p.maxAmount)}</option>
    `).join('');
    if (current && products.some(p => p.id === current)) sel.value = current;
  },

  selectedProduct() {
    const id = document.getElementById('n-product')?.value;
    if (!id) return null;
    return (DataStore.get().products || []).find(p => p.id === id) || null;
  },

  applyProduct() {
    const p = this.selectedProduct();
    this.initDocSlots();
    if (!p) {
      this.updateLoanPreview();
      return;
    }
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val;
    };
    set('n-rate', p.defaultRate);
    set('n-tenor', p.maxTenor);
    set('n-track', p.trackingFee ?? 0);
    set('n-pen', p.penaltyRate ?? 5);
    set('n-grace', p.graceDays ?? 7);
    this.updateLoanPreview();
  },

  readWizardTerms() {
    const today = new Date();
    const isoToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const disbEl = document.getElementById('n-disb');
    if (disbEl && !disbEl.value) disbEl.value = isoToday;
    const product = this.selectedProduct();

    return {
      customer: (document.getElementById('n-name')?.value || '').trim(),
      amount: this.readAmount('n-amt'),
      purpose: document.getElementById('n-purpose')?.value || 'Working Capital',
      tenor: parseInt(document.getElementById('n-tenor')?.value, 10) || 12,
      rate: parseFloat(document.getElementById('n-rate')?.value) || 5,
      trackingFee: this.readAmount('n-track'),
      penaltyRate: parseFloat(document.getElementById('n-pen')?.value) || 5,
      graceDays: parseInt(document.getElementById('n-grace')?.value, 10) || 7,
      disbursement: disbEl?.value || isoToday,
      firstDue: document.getElementById('n-firstDue')?.value || '',
      loanType: document.getElementById('n-loan-type')?.value || 'STRAIGHT_LOAN',
      vehicle: document.getElementById('n-make')?.value || '',
      reg: (document.getElementById('n-reg')?.value || '').trim().toUpperCase(),
      collateral: {
        marketValue: this.readAmount('n-val'),
        forcedSaleValue: this.readAmount('n-fsv'),
        valuationDate: document.getElementById('n-val-date')?.value || '',
        insuranceExpiryDate: document.getElementById('n-ins-expiry')?.value || ''
      },
      buyoffDetails: {
        companyName: (document.getElementById('n-buyoff-company')?.value || '').trim(),
        address: (document.getElementById('n-buyoff-address')?.value || '').trim(),
        town: (document.getElementById('n-buyoff-town')?.value || '').trim(),
        clientNames: (document.getElementById('n-buyoff-client')?.value || '').trim(),
        vehicleReg: (document.getElementById('n-buyoff-reg')?.value || '').trim().toUpperCase(),
        idNumber: (document.getElementById('n-buyoff-id')?.value || '').trim(),
        kraPin: (document.getElementById('n-buyoff-kra')?.value || '').trim(),
        lender: (document.getElementById('n-lender')?.value || '').trim(),
        balance: this.readAmount('n-outstanding'),
        buyoffAmt: this.readAmount('n-buyoff-amt'),
        netToCustomer: this.readAmount('n-net')
      },
      assetFinanceDetails: {
        sellerName: (document.getElementById('n-seller-name')?.value || '').trim(),
        sellerAddress: (document.getElementById('n-seller-address')?.value || '').trim(),
        sellerTown: (document.getElementById('n-seller-town')?.value || '').trim(),
        clientName: (document.getElementById('n-asset-client')?.value || '').trim(),
        clientIdNumber: (document.getElementById('n-id')?.value || '').trim(),
        clientKraPin: (document.getElementById('n-asset-kra')?.value || '').trim(),
        vehicleReg: (document.getElementById('n-reg')?.value || '').trim().toUpperCase(),
        chassisNumber: (document.getElementById('n-chassis')?.value || '').trim(),
        engineNumber: (document.getElementById('n-eng')?.value || '').trim()
      },
      productId: product?.id || '',
      productName: product?.name || ''
    };
  },

  onDisbursementChange() {
    const disbEl = document.getElementById('n-disb');
    const firstEl = document.getElementById('n-firstDue');
    const d = FinEngine.parseISODate(disbEl?.value);
    if (d && firstEl) firstEl.value = FinEngine.toISODate(FinEngine.firstInstallmentDate(d));
    this.updateLoanPreview();
  },

  renderOnboardSchedule(quote, containerId) {
    const box = document.getElementById(containerId);
    if (!box || !quote) {
      if (box) box.innerHTML = '';
      return;
    }
    const rows = quote.schedule.map(row => `
      <tr>
        <td>${row.n}</td>
        <td>${row.dueDate}</td>
        <td style="font-weight:700">${FinEngine.kes(row.installment)}</td>
        <td>${row.insuranceAddition ? `Insurance allocation: ${FinEngine.kes(row.insuranceAddition)}` : '—'}</td>
        <td>${FinEngine.kes(row.principal)}</td>
        <td>${FinEngine.kes(row.interest)}</td>
        <td>${FinEngine.kes(row.tracking)}</td>
        <td>${FinEngine.kes(row.remainingPrincipal)}</td>
        <td>${FinEngine.kes(row.remainingPayable)}</td>
      </tr>
    `).join('');
    box.innerHTML = `
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#166534;margin:14px 0 8px">On-time repayment schedule</div>
      <div class="table-responsive">
        <table class="tbl">
          <thead>
            <tr>
              <th>Month</th><th>Due date</th><th>Payment made</th><th>Insurance addition</th><th>Principal paid</th><th>Interest paid</th><th>Tracking paid</th><th>Outstanding principal</th><th>Outstanding total</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  },

  updateLoanPreview() {
    let terms = this.readWizardTerms();
    const firstEl = document.getElementById('n-firstDue');
    if (firstEl && !firstEl.value && terms.disbursement) {
      const d = FinEngine.parseISODate(terms.disbursement);
      if (d) firstEl.value = FinEngine.toISODate(FinEngine.firstInstallmentDate(d));
      terms = this.readWizardTerms();
    }
    const amt = terms.amount;
    const val = this.readAmount('n-val');
    const prevBox = document.getElementById('loan-preview-box');
    const ltvLabel = document.getElementById('ltv-check');
    const quote = amt > 0 ? FinEngine.quoteLogbookFlat(amt, terms.rate, terms.tenor, terms.trackingFee, terms.disbursement, terms.firstDue) : null;

    if (quote && prevBox) {
      const elMonthly = document.getElementById('prev-monthly');
      const elTotal = document.getElementById('prev-total');
      const elInt = document.getElementById('prev-int');
      const elTrack = document.getElementById('prev-track');
      const elTitle = document.getElementById('prev-quote-title');
      if (elMonthly) elMonthly.textContent = FinEngine.kes(quote.installment);
      if (elTotal) elTotal.textContent = FinEngine.kes(quote.totalPayable);
      if (elInt) elInt.textContent = FinEngine.kes(quote.totalInterest);
      if (elTrack) elTrack.textContent = FinEngine.kes(quote.totalTracking);
      if (elTitle) elTitle.textContent = `Logbook quote · ${terms.rate}% p.m. flat · ${terms.tenor} months`;
      const schedBox = document.getElementById('onboard-schedule-preview');
      if (schedBox) schedBox.innerHTML = '';
      prevBox.style.display = 'block';
    } else if (prevBox) {
      prevBox.style.display = 'none';
    }

    const product = this.selectedProduct();
    if (val > 0 && amt > 0 && ltvLabel) {
      const cap = product?.maxLTV || 80;
      const ltv = Math.round((amt / val) * 100);
      const isHigh = ltv > cap;
      ltvLabel.innerHTML = `LTV Ratio: <strong>${ltv}%</strong> ${isHigh ? `<span style="color:#DC2626">⚠️ Exceeds ${cap}% ${product ? product.name + ' ' : ''}policy threshold (Requires special credit approval)</span>` : `<span style="color:#059669">✓ Within ${cap}% policy limit</span>`}`;
    }
    const warn = document.getElementById('product-policy-warn');
    if (warn) {
      if (!product || amt <= 0) {
        warn.style.display = 'none';
      } else {
        const issues = [];
        if (product.minAmount && amt < product.minAmount) issues.push(`below minimum ${FinEngine.kes(product.minAmount)}`);
        if (product.maxAmount && amt > product.maxAmount) issues.push(`exceeds maximum ${FinEngine.kes(product.maxAmount)}`);
        if (product.minTenor && terms.tenor < product.minTenor) issues.push(`tenor below ${product.minTenor} months`);
        if (product.maxTenor && terms.tenor > product.maxTenor) issues.push(`tenor above ${product.maxTenor} months`);
        if (issues.length) {
          warn.style.display = 'block';
          warn.innerHTML = `<i class="ti ti-alert-triangle"></i> ${product.name}: requested terms ${issues.join('; ')}.`;
        } else {
          warn.style.display = 'none';
        }
      }
    }
  },

  canViewScheduleServicing() {
    return (typeof App !== 'undefined' && App.canViewScheduleServicing)
      ? App.canViewScheduleServicing()
      : false;
  },

  canGenerateOfferLetter() {
    const role = DataStore.get().activeRole;
    return role === 'CREDIT_ADMIN' || role === 'SUPER_ADMIN';
  },

  observeBranchOfferLetterActions() {
    if (this._branchOfferObserver) return;
    const container = document.getElementById('app-detail-content');
    if (!container || typeof MutationObserver === 'undefined') return;
    const attach = () => {
      const data = DataStore.get();
      const application = (data.applications || []).find(item => item.id === data.selectedAppId);
      const eligible = data.activeRole === 'BRANCH_ADMIN'
        && application?.assignedRole === 'BRANCH_ADMIN'
        && /^CONDITIONS(?:_|$)/.test(application.status || '');
      const existing = container.querySelector('[data-branch-offer-actions]');
      if (!eligible) {
        existing?.remove();
        return;
      }
      if (existing?.dataset.applicationId === application.id) return;
      existing?.remove();
      const panel = document.createElement('div');
      panel.dataset.branchOfferActions = 'true';
      panel.dataset.applicationId = application.id;
      panel.className = 'card';
      panel.style.cssText = 'margin-bottom:14px;border:1px solid #BFDBFE';
      panel.innerHTML = this.renderBranchOfferLetterActions(application);
      container.prepend(panel);
    };
    this._branchOfferObserver = new MutationObserver(attach);
    this._branchOfferObserver.observe(container, { childList: true, subtree: true });
    attach();
  },

  generatedOfferLetter(application) {
    const docs = Array.isArray(application?.documents) ? application.documents : [];
    const document = docs.find(doc => doc?.id === 'offer_letter'
      || (/offer\s*letter/i.test(`${doc?.label || ''} ${doc?.name || ''}`) && !/signed/i.test(`${doc?.label || ''} ${doc?.name || ''}`)));
    const offer = application?.offerLetter || application?.generatedOfferLetter
      || application?.offerLetterDocument || document;
    if (typeof offer === 'string') {
      return { id: 'offer_letter', label: 'Generated Offer Letter', name: `offer-letter-${application.id}.html`, type: 'text/html', html: offer };
    }
    if (offer && typeof offer === 'object') return offer;
    if (typeof application?.offerLetterHtml === 'string') {
      return { id: 'offer_letter', label: 'Generated Offer Letter', name: `offer-letter-${application.id}.html`, type: 'text/html', html: application.offerLetterHtml };
    }
    return null;
  },

  renderBranchOfferLetterActions(application) {
    const offer = this.generatedOfferLetter(application);
    const signed = (application.documents || []).find(doc => doc.id === 'signed_offer_letter');
    return `<div class="card-header"><div class="card-title-group"><i class="ti ti-file-certificate" style="font-size:18px;color:#0284C7"></i><span class="card-title">Offer Letter &amp; Conditions</span></div><span class="badge" style="background:#EFF6FF;color:#1D4ED8">Branch Admin action</span></div>
      <div class="card-body"><p style="font-size:12px;color:var(--text-secondary);margin:0 0 12px">Review and download the generated offer letter, have it signed by the customer, then upload the signed copy with the conditions documents.</p>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button type="button" class="btn btn-sm" ${offer ? `onclick="LOSModule.viewGeneratedOfferLetter('${this.escapeHtml(application.id)}')"` : 'disabled'}><i class="ti ti-eye"></i> View offer letter</button>
          <button type="button" class="btn btn-sm btn-primary" ${offer ? `onclick="LOSModule.downloadGeneratedOfferLetter('${this.escapeHtml(application.id)}')"` : 'disabled'}><i class="ti ti-download"></i> Download offer letter</button>
          ${offer ? '' : '<span class="hint">Generated offer letter is not available on this application yet.</span>'}
          <input type="file" id="signed-offer-file-${this.escapeHtml(application.id)}" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" style="display:none" onchange="LOSModule.uploadSignedOfferLetter(event, '${this.escapeHtml(application.id)}')">
          <button type="button" class="btn btn-sm btn-accent" onclick="document.getElementById('signed-offer-file-${this.escapeHtml(application.id)}').click()"><i class="ti ti-upload"></i> ${signed ? 'Replace signed offer letter' : 'Upload signed offer letter'}</button>
          ${signed ? `<button type="button" class="btn btn-sm" onclick="LOSModule.previewAppDoc('${this.escapeHtml(application.id)}', 'signed_offer_letter')"><i class="ti ti-file-search"></i> View signed copy</button><span class="hint">${this.escapeHtml(signed.name || 'Signed offer letter uploaded')}</span>` : ''}
        </div>
      </div>`;
  },

  offerLetterDocumentSource(offer) {
    if (!offer) return '';
    if (offer.dataUrl || offer.url || offer.blobUrl) return offer.dataUrl || offer.url || offer.blobUrl;
    const html = offer.html || offer.content || offer.htmlContent;
    return html ? `data:text/html;charset=utf-8,${encodeURIComponent(html)}` : '';
  },

  viewGeneratedOfferLetter(applicationId) {
    const application = (DataStore.get().applications || []).find(item => item.id === applicationId);
    const offer = this.generatedOfferLetter(application);
    if (!offer) { alert('No generated offer letter is available for this application.'); return; }
    const source = this.offerLetterDocumentSource(offer);
    if (!source && offer.id) { this.previewAppDoc(applicationId, offer.id); return; }
    if (!source) { alert('The generated offer letter is saved without a previewable document.'); return; }
    this.openDocPreview({ ...offer, dataUrl: source, name: offer.name || `offer-letter-${applicationId}.html`, label: offer.label || 'Generated Offer Letter', type: offer.type || (String(source).startsWith('data:text/html') ? 'text/html' : '') });
  },

  downloadGeneratedOfferLetter(applicationId) {
    const application = (DataStore.get().applications || []).find(item => item.id === applicationId);
    const offer = this.generatedOfferLetter(application);
    if (!offer) { alert('No generated offer letter is available for this application.'); return; }
    let source = this.offerLetterDocumentSource(offer);
    if (!source && offer.id) {
      try {
        const cached = JSON.parse(sessionStorage.getItem(`SPECTRUM_DOC_CACHE_${applicationId}`) || '[]').find(doc => doc.id === offer.id);
        source = cached?.dataUrl || '';
      } catch (_) {}
    }
    if (!source) { alert('The generated offer letter file is not available to download in this browser session.'); return; }
    const link = document.createElement('a');
    link.href = source;
    link.download = offer.name || `offer-letter-${applicationId}.${String(offer.type || '').includes('pdf') ? 'pdf' : 'html'}`;
    link.target = '_blank';
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
  },

  uploadSignedOfferLetter(event, applicationId) {
    const file = event.target?.files?.[0];
    if (!file) return;
    const data = DataStore.get();
    const application = (data.applications || []).find(item => item.id === applicationId);
    if (data.activeRole !== 'BRANCH_ADMIN' || !application || application.assignedRole !== 'BRANCH_ADMIN'
      || !/^CONDITIONS(?:_|$)/.test(application.status || '')) {
      alert('Only the Branch Admin assigned to conditions upload can attach the signed offer letter.');
      event.target.value = '';
      return;
    }
    if (!this.isAllowedDoc(file)) {
      alert('Please upload a PDF or image (JPG, PNG, WEBP).');
      event.target.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert('File is too large. Maximum size is 5 MB.');
      event.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const uploadedAt = new Date().toISOString();
      const document = {
        id: 'signed_offer_letter',
        label: 'Signed Offer Letter',
        name: file.name,
        type: this.inferDocumentType(file.name, reader.result) || file.type || 'application/pdf',
        size: file.size,
        dataUrl: reader.result,
        uploadedAt,
        uploadedBy: 'BRANCH_ADMIN'
      };
      application.documents = Array.isArray(application.documents) ? application.documents : [];
      application.documents = application.documents.filter(doc => doc.id !== document.id);
      application.documents.push(document);
      application.signedOfferLetter = { ...document };
      application.audit = Array.isArray(application.audit) ? application.audit : [];
      application.audit.unshift({
        action: 'Signed offer letter uploaded',
        by: data.roles?.BRANCH_ADMIN?.title || 'Branch Admin',
        at: uploadedAt.slice(0, 16).replace('T', ' ')
      });
      this._docCache[applicationId] = (this._docCache[applicationId] || []).filter(doc => doc.id !== document.id);
      this._docCache[applicationId].push(document);
      try { sessionStorage.setItem(`SPECTRUM_DOC_CACHE_${applicationId}`, JSON.stringify(this._docCache[applicationId])); } catch (_) {}
      DataStore.save(data);
      event.target.value = '';
      this.openApplicationDetail(applicationId);
    };
    reader.onerror = () => {
      alert('Could not read that file. Please try another copy.');
      event.target.value = '';
    };
    reader.readAsDataURL(file);
  },

  openCustomerAccount(appId) {
    const data = DataStore.get();
    const loan = (data.loans || []).find(l => l.appId === appId);
    if (loan) {
      LMSModule.openLoan360(loan.accountNumber);
      return;
    }
    this.openApplicationDetail(appId);
  },

  openLogbookCalculator(appId) {
    if (!this.canViewScheduleServicing()) {
      alert('Schedule, arrears and statements are available after disbursement for Overall Admin and Collection & Recovery.');
      return;
    }
    if (typeof LogbookCalculator === 'undefined') return;

    const data = DataStore.get();
    const loan = appId
      ? (data.loans || []).find(l => l.appId === appId)
      : null;

    if (!loan) {
      alert('Schedule, arrears and statements are available after the facility is disbursed.');
      return;
    }
    LogbookCalculator.openForLoan(loan.accountNumber);
  },

  buildReviewSummary() {
    const name = document.getElementById('n-name')?.value || '—';
    const idNo = document.getElementById('n-id')?.value || '—';
    const kra = document.getElementById('n-kra')?.value || '—';
    const phone = document.getElementById('n-phone')?.value || '—';
    const terms = this.readWizardTerms();
    const amt = terms.amount;
    const purpose = terms.purpose;
    const reg = terms.reg || '—';
    const make = terms.vehicle || '—';
    const val = this.readAmount('n-val');
    const forcedSaleValue = this.readAmount('n-fsv');
    const valuationDate = document.getElementById('n-val-date')?.value || '';
    const insuranceExpiryDate = document.getElementById('n-ins-expiry')?.value || '';
    const ltv = val > 0 ? Math.round((amt / val) * 100) : 0;
    const quote = amt > 0 ? FinEngine.quoteLogbookFlat(amt, terms.rate, terms.tenor, terms.trackingFee, terms.disbursement, terms.firstDue) : null;

    // Evaluate Credit Score preview
    const evalResult = FinEngine.evaluateCreditRisk({
      amount: amt,
      valuation: val,
      monthlyIncome: 120000,
      existingDebt: 20000,
      vehicleYear: parseInt(document.getElementById('n-year')?.value) || 2017,
      crbListed: false
    });

    const rev = document.getElementById('review-content');
    if (!rev) return;

    rev.innerHTML = `
      <div class="alert alert-info">
        <i class="ti ti-info-circle"></i>
        <span>Review all details carefully before submission. Once submitted, the application enters the automated risk scoring pipeline and alerts the Risk Officer.</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:1rem">
        <div class="card" style="margin:0;padding:12px">
          <div class="section-label" style="margin-top:0">Customer Profile</div>
          <div class="detail-row"><span class="detail-label">Name</span><span class="detail-val">${name}</span></div>
          <div class="detail-row"><span class="detail-label">ID / Registration</span><span class="detail-val">${idNo}</span></div>
          <div class="detail-row"><span class="detail-label">KRA PIN</span><span class="detail-val">${kra}</span></div>
          <div class="detail-row"><span class="detail-label">Phone</span><span class="detail-val">${phone}</span></div>
        </div>
        <div class="card" style="margin:0;padding:12px">
          <div class="section-label" style="margin-top:0">Loan & Collateral</div>
          <div class="detail-row"><span class="detail-label">Type of Loan</span><span class="detail-val">${this.loanTypeLabel(terms.loanType)}</span></div>
          <div class="detail-row"><span class="detail-label">Loan Product</span><span class="detail-val">${terms.productName || 'Custom terms'}</span></div>
          <div class="detail-row"><span class="detail-label">Requested Principal</span><span class="detail-val" style="color:#0284C7">${FinEngine.kes(amt)}</span></div>
          <div class="detail-row"><span class="detail-label">Purpose</span><span class="detail-val">${purpose}</span></div>
          <div class="detail-row"><span class="detail-label">Tenor / Flat rate</span><span class="detail-val">${terms.tenor} months · ${terms.rate}% p.m.</span></div>
          <div class="detail-row"><span class="detail-label">Tracking / Penalty</span><span class="detail-val">${FinEngine.kes(terms.trackingFee)} / mo · ${terms.penaltyRate}% weekly after ${terms.graceDays}d</span></div>
          <div class="detail-row"><span class="detail-label">Vehicle</span><span class="detail-val">${make} (${reg})</span></div>
          ${terms.loanType === 'BUY_OFF' ? `
            <div class="section-label">Buy-off Details</div>
            <div class="detail-row"><span class="detail-label">Company</span><span class="detail-val">${terms.buyoffDetails.companyName || '—'}</span></div>
            <div class="detail-row"><span class="detail-label">Address / Town</span><span class="detail-val">${terms.buyoffDetails.address || '—'} / ${terms.buyoffDetails.town || '—'}</span></div>
            <div class="detail-row"><span class="detail-label">Client / ID / KRA PIN</span><span class="detail-val">${terms.buyoffDetails.clientNames || '—'} / ${terms.buyoffDetails.idNumber || '—'} / ${terms.buyoffDetails.kraPin || '—'}</span></div>
            <div class="detail-row"><span class="detail-label">Motor Vehicle Reg. No.</span><span class="detail-val">${terms.buyoffDetails.vehicleReg || '—'}</span></div>
          ` : ''}
          ${terms.loanType === 'ASSET_FINANCE' ? `
            <div class="section-label">Asset Finance Details</div>
            <div class="detail-row"><span class="detail-label">Seller</span><span class="detail-val">${terms.assetFinanceDetails.sellerName || '—'}</span></div>
            <div class="detail-row"><span class="detail-label">Seller Address / Town</span><span class="detail-val">${terms.assetFinanceDetails.sellerAddress || '—'} / ${terms.assetFinanceDetails.sellerTown || '—'}</span></div>
            <div class="detail-row"><span class="detail-label">Client / KRA PIN</span><span class="detail-val">${terms.assetFinanceDetails.clientName || '—'} / ${terms.assetFinanceDetails.clientKraPin || '—'}</span></div>
          ` : ''}
          <div class="detail-row"><span class="detail-label">Market Value / LTV</span><span class="detail-val">${FinEngine.kes(val)} (${ltv}%)</span></div>
          <div class="detail-row"><span class="detail-label">Forced Sale Value</span><span class="detail-val">${forcedSaleValue ? FinEngine.kes(forcedSaleValue) : '—'}</span></div>
          <div class="detail-row"><span class="detail-label">Valuation Date</span><span class="detail-val">${valuationDate || '—'}</span></div>
          <div class="detail-row"><span class="detail-label">Insurance Expiry Date</span><span class="detail-val">${insuranceExpiryDate || '—'}</span></div>
        </div>
      </div>
      ${quote ? `
        <div class="card" style="margin:0 0 1rem;padding:12px">
          <div class="section-label" style="margin-top:0">Proposed facility quote</div>
          <div class="detail-row"><span class="detail-label">Monthly installment</span><span class="detail-val" style="color:#0284C7">${FinEngine.kes(quote.installment)}</span></div>
          <div class="detail-row"><span class="detail-label">On-time total payable</span><span class="detail-val">${FinEngine.kes(quote.totalPayable)}</span></div>
        </div>
      ` : ''}
      <div class="card" style="margin:0;padding:12px;background:#F8FAFC">
        <div class="section-label" style="margin-top:0">Instant Credit Risk Scoring</div>
        <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:10px;text-align:center">
          <div><div style="font-size:11px;color:var(--text-secondary)">Bureau & Score</div><div style="font-size:18px;font-weight:700;color:#0284C7">${evalResult.score} / 850</div></div>
          <div><div style="font-size:11px;color:var(--text-secondary)">Risk Grade</div><div style="font-size:16px;font-weight:700;color:#059669">${evalResult.grade}</div></div>
          <div><div style="font-size:11px;color:var(--text-secondary)">Recommendation</div><div style="font-size:12px;font-weight:700;margin-top:4px">${evalResult.decision.replace(/_/g, ' ')}</div></div>
        </div>
      </div>
      <div class="card kyc-documents-panel" style="margin:1rem 0 0">
        <div class="card-header">
          <div class="card-title-group">
            <i class="ti ti-id-badge-2" style="color:var(--brand-accent);font-size:17px"></i>
            <span class="card-title">Borrower KYC &amp; Identity Documents</span>
            <span class="badge" style="background:#ECFDF5;color:#047857">${this.snapshotIntakeDocs().length} attached</span>
          </div>
        </div>
        <div class="card-body">
          ${this.snapshotIntakeDocs().length
            ? this.renderKycDocumentCards(this.snapshotIntakeDocs())
            : `<div class="kyc-empty-state"><i class="ti ti-upload"></i><span>No documents uploaded yet. Go back to step 4 to attach KYC files.</span></div>`}
        </div>
      </div>
    `;
  },

  /*
   * Book a facility from the application detail action.
   * This is intentionally kept as a compatibility entry point because older
   * detail templates call different booking handler names.
   */
  bookFacility(appId) {
    const data = DataStore.get();
    const role = data.activeRole;
    if (!['CREDIT_ADMIN', 'SUPER_ADMIN'].includes(role)) {
      alert('Only Credit Admin or Super Admin can book a loan facility.');
      return;
    }

    const application = (data.applications || []).find(item => item.id === appId);
    if (!application) {
      alert('The application could not be found.');
      return;
    }
    if (application.status === 'DISBURSED' || (data.loans || []).some(loan => loan.appId === appId)) {
      alert('This facility has already been booked.');
      return;
    }
    if (!['CONDITIONS_MET', 'FINAL_APPROVED', 'LOAN_BOOKING', 'VOUCHER_PREPARED'].includes(application.status)) {
      alert('The facility must have approved terms and all conditions met before booking.');
      return;
    }

    const principal = Number(application.approvedAmount || application.amount) || 0;
    const tenor = Number(application.approvedDuration || application.requestedDuration) || 12;
    const rate = Number(application.approvedRate || application.requestedRate) || 5;
    const trackingFee = Number(application.trackingFee) || 0;
    const scheduleQuote = this.applyInsuranceToQuote(FinEngine.quoteLogbookFlat(
      principal,
      rate,
      tenor,
      trackingFee,
      application.proposedDisbursementDate,
      application.firstDueDate
    ), application);
    if (!scheduleQuote) {
      alert('Unable to generate the repayment schedule. Check the approved facility terms.');
      return;
    }

    const sequence = (data.loans || []).reduce((max, loan) => {
      const match = String(loan.accountNumber || '').match(/(\\d+)$/);
      return Math.max(max, match ? Number(match[1]) : 0);
    }, 0) + 1;
    const accountNumber = `ACC-${new Date().getFullYear()}-${String(sequence).padStart(4, '0')}`;
    const today = new Date().toISOString().slice(0, 10);
    const now = new Date().toTimeString().slice(0, 5);
    const vaultId = `VAULT-${new Date().getFullYear()}-${String(sequence).padStart(4, '0')}`;

    const loan = {
      accountNumber,
      appId,
      customer: application.customer,
      phone: application.phone || '',
      email: application.email || '',
      idNumber: application.idNumber || '',
      vehicle: application.vehicle || '',
      reg: application.reg || '',
      valuation: application.valuation || 0,
      disbursedAmount: principal,
      currentPrincipal: principal,
      approvedRate: rate,
      tenorMonths: tenor,
      amortizationMethod: 'FLAT',
      trackingFee,
      penaltyRate: Number(application.penaltyRate) || 5,
      graceDays: Number(application.graceDays) || 7,
      disbursementDate: application.proposedDisbursementDate || today,
      nextDueDate: scheduleQuote.firstDueDate,
      daysPastDue: 0,
      parStatus: 'PAR_0',
      unpaidPenalties: 0,
      unpaidInterest: 0,
      totalPaid: 0,
      status: 'BOOKED',
      collateralVaultId: vaultId,
      gpsTrackerId: '',
      insuranceDebitNote: application.insuranceDebitNote || null,
      insuranceAllocation: scheduleQuote.insuranceAllocation || null,
      schedule: scheduleQuote.schedule.map(row => ({
        period: row.n,
        dueDate: row.dueDate,
        installment: row.installment,
        insuranceAddition: row.insuranceAddition || 0,
        principal: row.principal,
        interest: row.interest,
        balance: row.remainingPrincipal,
        status: 'PENDING',
        paidAmount: 0,
        paidDate: null,
        daysOverdue: 0
      })),
      repaymentsHistory: [],
      assignedCollectionsRole: null,
      noticeStage: 0,
      collectionsLog: []
    };

    data.loans = Array.isArray(data.loans) ? data.loans : [];
    data.loans.unshift(loan);
    application.status = 'LOAN_BOOKING';
    application.stage = 6;
    application.assignedRole = 'FINANCE_OFFICER';
    application.approvedAmount = principal;
    application.approvedDuration = tenor;
    application.approvedRate = rate;
    application.audit = Array.isArray(application.audit) ? application.audit : [];
    application.audit.unshift({
      action: `Facility booked and repayment schedule generated for ${accountNumber}`,
      by: data.roles[role]?.title || role,
      at: `${today} ${now}`
    });

    data.generalLedger = Array.isArray(data.generalLedger) ? data.generalLedger : [];
    data.notifications = Array.isArray(data.notifications) ? data.notifications : [];
    data.notifications.unshift({
      id: Date.now(),
      role: 'FINANCE_OFFICER',
      message: `Facility ${accountNumber} (${application.customer}) is booked and ready for voucher preparation.`,
      appId: accountNumber,
      time: `${today} ${now}`,
      read: false
    });

    const saved = DataStore.save(data);
    if (!saved) {
      data.loans = data.loans.filter(item => item.accountNumber !== accountNumber);
      alert('Facility could not be saved in this browser.');
      return;
    }

    alert(`Facility ${accountNumber} booked successfully and repayment schedule generated.`);
    this.openApplicationDetail(appId);
    if (typeof App !== 'undefined') {
      App.updateTopMetrics();
      App.updateNotifications();
    }
  },

  bookLoanFacility(appId) {
    return this.bookFacility(appId);
  },

  bookApplication(appId) {
    return this.bookFacility(appId);
  },

  bookLoan(appId) {
    return this.bookFacility(appId);
  },

  submitNewApplication() {
    const data = DataStore.get();
    if (!this.canCreateApplication()) {
      alert('Only Branch Admin can add a new loan application.');
      return;
    }

    const terms = this.readWizardTerms();
    const name = terms.customer;
    const amt = terms.amount;
    const reg = terms.reg;
    const marketValue = terms.collateral.marketValue;
    const forcedSaleValue = terms.collateral.forcedSaleValue;
    const valuationDate = terms.collateral.valuationDate;
    const insuranceExpiryDate = terms.collateral.insuranceExpiryDate;

    if (!name || amt <= 0 || !reg) {
      alert('Please fill in customer full name, loan amount, and vehicle registration.');
      this.goStep(1);
      return;
    }
    if (marketValue <= 0 || forcedSaleValue <= 0 || !valuationDate || !insuranceExpiryDate) {
      alert('Please provide Market Value, Forced Sale Value, Valuation Date, and Insurance Expiry Date.');
      this.goStep(3);
      return;
    }
    if (!this.validateFacilityTypeDetails(terms)) return;
    if (forcedSaleValue > marketValue) {
      alert('Forced Sale Value cannot be greater than Market Value.');
      this.goStep(3);
      return;
    }

    const product = this.selectedProduct();
    if (product) {
      if (product.minAmount && amt < product.minAmount) {
        alert(`${product.name} minimum facility is ${FinEngine.kes(product.minAmount)}.`);
        this.goStep(2);
        return;
      }
      if (product.maxAmount && amt > product.maxAmount) {
        alert(`${product.name} maximum facility is ${FinEngine.kes(product.maxAmount)}.`);
        this.goStep(2);
        return;
      }
      if (product.minTenor && terms.tenor < product.minTenor) {
        alert(`${product.name} minimum tenor is ${product.minTenor} months.`);
        this.goStep(2);
        return;
      }
      if (product.maxTenor && terms.tenor > product.maxTenor) {
        alert(`${product.name} maximum tenor is ${product.maxTenor} months.`);
        this.goStep(2);
        return;
      }
    }

    const applicationYear = new Date().getFullYear();
    const appSequence = (data.applications || []).reduce((max, application) => {
      const match = String(application.id || '').match(new RegExp(`^LBL-${applicationYear}-(\\d+)$`));
      return Math.max(max, match ? Number(match[1]) : 0);
    }, 0) + 1;
    const appId = `LBL-${applicationYear}-${String(appSequence).padStart(4, '0')}`;
    const today = new Date().toISOString().slice(0, 10);
    const nowTime = new Date().toTimeString().slice(0, 5);

    const isBiz = document.querySelector('input[name="cust-type"]:checked')?.value === 'BUSINESS';
    const valuation = marketValue;


    const creditScore = FinEngine.evaluateCreditRisk({
      amount: amt,
      valuation,
      monthlyIncome: 130000,
      existingDebt: 25000,
      vehicleYear: parseInt(document.getElementById('n-year')?.value) || 2017,
      crbListed: false
    });

    const isHighValue = amt > 2000000;
    const attachedDocs = this.snapshotIntakeDocs();

    const newApp = {
      id: appId,
      customer: name,
      idNumber: document.getElementById('n-id')?.value || '12345678',
      kraPin: document.getElementById('n-kra')?.value || 'A009827181X',
      phone: document.getElementById('n-phone')?.value || '+254 700 000 000',
      email: document.getElementById('n-email')?.value || 'client@spectrumcredit.co.ke',
      postalAddress: document.getElementById('n-address')?.value.trim() || '',
      town: document.getElementById('n-town')?.value.trim() || '',
      type: isBiz ? 'BUSINESS' : 'INDIVIDUAL',
      vehicle: document.getElementById('n-make')?.value || 'Toyota Axio 2017',
      reg: reg.toUpperCase(),
      engineNo: document.getElementById('n-eng')?.value || 'ENG-99281',
      chassisNo: document.getElementById('n-chassis')?.value || 'CHS-881920',
      valuation,
      forcedSaleValue,
      valuationDate,
      insuranceExpiryDate,
      amount: amt,
      purpose: terms.purpose || 'Business Working Capital',
      loanType: terms.loanType || 'STRAIGHT_LOAN',
      productId: terms.productId || '',
      productName: terms.productName || '',
      requestedDuration: terms.tenor,
      requestedRate: terms.rate,
      trackingFee: terms.trackingFee,
      penaltyRate: terms.penaltyRate,
      graceDays: terms.graceDays,
      proposedDisbursementDate: terms.disbursement,
      firstDueDate: terms.firstDue || '',
      // Risk Officer owns the first underwriting step immediately after intake.
      status: 'RISK_REVIEW',
      stage: 2,
      assignedRole: 'RISK_OFFICER',
      branch: App.activeBranch(data) || null,
      slaHours: 24,
      createdAt: today,
      isEscalated: isHighValue,
      hasBuyoff: terms.loanType === 'BUY_OFF',
      buyoffDetails: terms.loanType === 'BUY_OFF' ? terms.buyoffDetails : null,
      assetFinanceDetails: terms.loanType === 'ASSET_FINANCE' ? terms.assetFinanceDetails : null,
      creditScore,
      documents: attachedDocs,
      conditions: [],
      approvedAmount: 0,
      approvedDuration: 0,
      approvedRate: 0,
      audit: [
        { action: `Application submitted with KYC & appraisal details${terms.productName ? ` · Product: ${terms.productName}` : ''}${attachedDocs.length ? ` · ${attachedDocs.length} document(s) attached` : ''}`, by: `Branch Admin (${data.activeRole})`, at: `${today} ${nowTime}` },
        { action: `Credit scoring computed: ${creditScore.score} points (${creditScore.grade})`, by: 'System Risk Engine', at: `${today} ${nowTime}` },
        { action: 'Assigned to Risk Officer for verification', by: 'Workflow Dispatcher', at: `${today} ${nowTime}` }
      ]
    };

    if (isHighValue) {
      newApp.audit.push({
        action: 'Flagged for CEO/Credit Committee approval (Principal exceeds KES 2,000,000 threshold)',
        by: 'Policy Engine',
        at: `${today} ${nowTime}`
      });
    }

    data.applications.unshift(newApp);
    this._docCache[appId] = attachedDocs;

    // Notification for Risk Officer
    data.notifications.unshift({
      id: Date.now(),
      role: 'RISK_OFFICER',
      message: `New application ${appId} (${name}) submitted for risk appraisal`,
      appId,
      time: `${today} ${nowTime}`,
      read: false
    });

    const saved = DataStore.save(data);
    if (!saved) {
      alert('Application could not be saved in this browser. Clear captured data or free browser storage, then try again.');
      data.applications = (data.applications || []).filter(application => application.id !== appId);
      data.notifications = (data.notifications || []).filter(notification => notification.appId !== appId);
      return;
    }
    // Ensure localStorage purge does not silently drop uploaded binaries
    // for this browser session; cache them so Preview can still retrieve them.
    this.clearDraft();

    if (attachedDocs.length) {
      try {
        sessionStorage.setItem(
          `SPECTRUM_DOC_CACHE_${appId}`,
          JSON.stringify(attachedDocs.map(d => ({ id: d.id, dataUrl: d.dataUrl })))
        );
      } catch (e) {
        console.warn('Could not cache intake documents in sessionStorage', e);
      }
    }

    this.intakeDocs = {};
    alert(`Application ${appId} submitted successfully! Handed over to Risk Officer.`);
    this.renderApplicationsTable();
    App.showTab('applications');
  },

  renderApplicationsTable() {
    const data = DataStore.get();
    const container = document.getElementById('apps-table-container');
    if (!container) return;

    const q = (document.getElementById('app-search')?.value || '').toLowerCase();
    const statusFilter = document.getElementById('status-filter')?.value || '';
    // Applications leave the LOS pipeline once disbursed and are managed in LMS.
    const totalApplications = (typeof App !== 'undefined' && App.getApplicationCount)
      ? App.getApplicationCount(data)
      : (Array.isArray(data.applications)
        ? data.applications.filter(a => a.status !== 'DISBURSED').length
        : 0);
    const pipelineCountEl = document.getElementById('los-pipeline-count');
    if (pipelineCountEl) pipelineCountEl.textContent = `${totalApplications} application${totalApplications === 1 ? '' : 's'}`;

    // The LOS table contains origination work only; disbursed records belong to LMS.
    let list = (data.applications || []).filter(a => a.status !== 'DISBURSED').filter(a => {
      const matchQuery = !q || a.customer.toLowerCase().includes(q) || a.id.toLowerCase().includes(q) || a.reg.toLowerCase().includes(q);
      const matchStatus = !statusFilter || a.status === statusFilter;
      return matchQuery && matchStatus;
    });

    // Branch Admins only see applications belonging to their assigned branch.
    if (data.activeRole === 'BRANCH_ADMIN' && typeof App !== 'undefined' && App.activeBranch) {
      const branch = App.activeBranch(data);
      list = list.filter(a => a.branch === branch);
    }

    // Role filtering for security
    if (data.activeRole !== 'OVERALL_ADMIN' && data.activeRole !== 'SUPER_ADMIN' && data.activeRole !== 'CEO_COMMITTEE') {
      list = list.filter(a => a.assignedRole === data.activeRole || data.activeRole === 'BRANCH_ADMIN');
    }

    if (!list.length) {
      container.innerHTML = `
        <div style="text-align:center;padding:2.5rem;color:var(--text-tertiary)">
          <i class="ti ti-files-off" style="font-size:32px;display:block;margin-bottom:8px"></i>
          No applications match current filters for role ${data.activeRole}.
        </div>`;
      return;
    }

    container.innerHTML = `
      <div class="table-responsive">
        <table class="tbl">
          <thead>
            <tr>
              <th style="width:110px">Application No.</th>
              <th>Customer</th>
              <th>Vehicle / Reg</th>
              <th>Amount (KES)</th>
              <th>LTV</th>
              <th>Status</th>
              <th>Assigned To</th>
              <th>SLA</th>
              <th style="text-align:right">Action</th>
            </tr>
          </thead>
          <tbody>
            ${list.map(a => {
              const ltv = a.valuation ? Math.round((a.amount / a.valuation) * 100) : 0;
              return `
                <tr>
                  <td><span class="app-num">${a.id}</span></td>
                  <td>
                    <div style="font-weight:600;cursor:pointer;color:var(--brand-accent-dark)" onclick="LOSModule.openCustomerAccount('${a.id}')" title="Open account / file">${a.customer}</div>
                    <div style="font-size:11px;color:var(--text-secondary)">${a.phone}</div>
                  </td>
                  <td>
                    <div>${a.vehicle}</div>
                    <div style="font-size:11px;color:var(--text-secondary);font-family:var(--font-mono)">${a.reg}</div>
                  </td>
                  <td style="font-weight:600">${FinEngine.kes(a.amount)}</td>
                  <td>
                    <span style="font-weight:600;color:${ltv > 80 ? '#DC2626' : '#059669'}">${ltv}%</span>
                  </td>
                  <td>
                    <span class="badge b-${a.status.toLowerCase()}">${a.status.replace(/_/g, ' ').toLowerCase()}</span>
                    ${a.isEscalated ? '<div style="font-size:9.5px;color:#DC2626;font-weight:700">★ High Value / Escalated</div>' : ''}
                  </td>
                  <td><span style="font-size:11px;font-weight:600;color:var(--text-secondary)">${a.assignedRole ? (data.roles[a.assignedRole]?.title || a.assignedRole) : '—'}</span></td>
                  <td>
                    ${a.slaHours > 0 ? `
                      <div style="font-size:10.5px;color:${a.slaHours < 8 ? '#DC2626' : '#D97706'}">${a.slaHours}h left</div>
                      <div class="sla-bar"><div class="sla-fill" style="width:${Math.min(100, Math.round((48 - a.slaHours) / 48 * 100))}%;background:${a.slaHours < 8 ? '#DC2626' : '#D97706'}"></div></div>
                    ` : '<span style="color:var(--text-tertiary)">Completed</span>'}
                  </td>
                  <td style="text-align:right">
                    <button class="btn btn-sm btn-primary" onclick="LOSModule.openApplicationDetail('${a.id}')">
                      <i class="ti ti-eye"></i> View File
                    </button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  },

  openApplicationDetail(id) {
    const data = DataStore.get();
    if (App.isCollectionsRole(data.activeRole)) {
      const loan = (data.loans || []).find(l => l.appId === id);
      if (loan) LMSModule.openLoan360(loan.accountNumber);
      else App.showTab('loans');
      return;
    }

    const a = (data.applications || []).find(x => x.id === id);
    if (!a) return;

    data.selectedAppId = id;
    DataStore.save(data);

    const stages = [
      'Application', 'Risk Review', 'First Approval', 'Conditions', 'Verification',
      'Loan Booking', 'Final Approval', 'Voucher Prep', 'Disbursement', 'Complete'
    ];

    const ltv = a.valuation ? Math.round((a.amount / a.valuation) * 100) : 0;
    const canAct = this.getPermittedActions(a, data.activeRole) || [];
    const linkedLoan = (data.loans || []).find(l => l.appId === a.id);
    const showServicing = this.canViewScheduleServicing() && a.status === 'DISBURSED' && !!linkedLoan;

    const container = document.getElementById('app-detail-content');
    if (!container) return;

    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
        <div>
          <button class="btn btn-sm" onclick="App.showTab('applications')" style="margin-bottom:6px">
            <i class="ti ti-arrow-left"></i> Back to Applications
          </button>
          <div style="font-size:18px;font-weight:700;color:var(--brand-primary)">${a.customer}</div>
          <div style="font-size:12px;color:var(--text-secondary)">File Reference: <span class="app-num">${a.id}</span> · Type: ${a.type}</div>
        </div>
        <div style="text-align:right">
          <span class="badge b-${a.status.toLowerCase()}" style="font-size:12px;padding:4px 10px">${a.status.replace(/_/g, ' ').toLowerCase()}</span>
          ${a.isEscalated ? '<div style="font-size:11px;color:#DC2626;font-weight:700;margin-top:4px"><i class="ti ti-gavel"></i> Escalated to CEO / Credit Committee</div>' : ''}
          ${showServicing ? `
          <div style="margin-top:8px">
            <button class="btn btn-sm btn-primary" onclick="LOSModule.openLogbookCalculator('${a.id}')">
              <i class="ti ti-calendar-stats"></i> Schedule, Arrears &amp; Statement
            </button>
          </div>` : ''}
          ${['CREDIT_ADMIN', 'SUPER_ADMIN'].includes(data.activeRole) && ['CONDITIONS_MET', 'FINAL_APPROVED', 'LOAN_BOOKING', 'VOUCHER_PREPARED'].includes(a.status) ? `
          <div style="margin-top:8px">
            <button class="btn btn-sm btn-success" onclick="LOSModule.bookFacility('${a.id}')">
              <i class="ti ti-building-bank"></i> Book Facility
            </button>
          </div>` : ''}
        </div>
      </div>

      <!-- Stage Flow Track -->
      <div class="stage-flow-track">
        ${stages.map((s, idx) => {
          const stepNo = idx + 1;
          const isDone = stepNo < a.stage;
          const isActive = stepNo === a.stage;
          return `
            <div class="stage-step ${isDone ? 'done' : isActive ? 'active' : 'pending'}">
              <div>${stepNo}. ${s}</div>
            </div>
          `;
        }).join('')}
      </div>

      <!-- Two-Column Overview -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:1.25rem">
        <div class="card" style="margin:0">
          <div class="card-header"><span class="card-title">Loan Request & Approved Terms</span></div>
          <div class="card-body">
            <div class="detail-row"><span class="detail-label">Loan Product</span><span class="detail-val">${a.productName || a.productId || 'Custom terms'}</span></div>
            <div class="detail-row"><span class="detail-label">Requested Principal</span><span class="detail-val">${FinEngine.kes(a.amount)}</span></div>
            <div class="detail-row"><span class="detail-label">Type of Loan</span><span class="detail-val">${this.loanTypeLabel(a.loanType || (a.hasBuyoff ? 'BUY_OFF' : 'STRAIGHT_LOAN'))}</span></div>
            <div class="detail-row"><span class="detail-label">Loan Purpose</span><span class="detail-val">${a.purpose}</span></div>
            <div class="detail-row"><span class="detail-label">Requested Tenor / Rate</span><span class="detail-val">${a.requestedDuration || a.approvedDuration || 12} months · ${a.requestedRate || a.approvedRate || 5}% p.m. flat</span></div>
            <div class="detail-row"><span class="detail-label">Tracking / Penalty</span><span class="detail-val">${FinEngine.kes(a.trackingFee || 0)} / mo · ${a.penaltyRate || 5}% weekly after ${a.graceDays || 7}d</span></div>
            <div class="detail-row"><span class="detail-label">Loan Buyoff / Refinance</span><span class="detail-val">${a.hasBuyoff ? 'Yes (Refinance)' : 'No'}</span></div>
            ${a.hasBuyoff && a.buyoffDetails ? `
              <div class="detail-row"><span class="detail-label">Existing Lender</span><span class="detail-val">${a.buyoffDetails.lender}</span></div>
              <div class="detail-row"><span class="detail-label">Buyoff Payoff Sum</span><span class="detail-val">${FinEngine.kes(a.buyoffDetails.buyoffAmt)}</span></div>
              <div class="detail-row"><span class="detail-label">Net To Customer</span><span class="detail-val" style="color:#059669">${FinEngine.kes(a.buyoffDetails.netToCustomer)}</span></div>
            ` : ''}
            <div class="section-label">Credit Decision Terms</div>
            <div class="detail-row"><span class="detail-label">Approved Facility</span><span class="detail-val" style="color:#059669">${a.approvedAmount ? FinEngine.kes(a.approvedAmount) : 'Pending Final Terms'}</span></div>
            <div class="detail-row"><span class="detail-label">Approved Rate</span><span class="detail-val">${a.approvedRate ? a.approvedRate + '% p.m.' : '—'}</span></div>
            <div class="detail-row"><span class="detail-label">Tenor</span><span class="detail-val">${a.approvedDuration ? a.approvedDuration + ' Months' : '—'}</span></div>
            ${(() => {
              const qAmt = a.approvedAmount || a.amount;
              const qRate = a.approvedRate || a.requestedRate || 5;
              const qTenor = a.approvedDuration || a.requestedDuration || 12;
              const q = FinEngine.quoteLogbookFlat(qAmt, qRate, qTenor, a.trackingFee || 0, a.proposedDisbursementDate || a.createdAt, a.firstDueDate);
              return q ? `<div class="detail-row"><span class="detail-label">Logbook monthly installment</span><span class="detail-val" style="color:#0284C7">${FinEngine.kes(q.installment)}</span></div>
              <div class="detail-row"><span class="detail-label">On-time total payable</span><span class="detail-val">${FinEngine.kes(q.totalPayable)}</span></div>` : '';
            })()}
          </div>
        </div>

        <div class="card" style="margin:0">
          <div class="card-header"><span class="card-title">Collateral & Vehicle Appraisal</span></div>
          <div class="card-body">
            <div class="detail-row"><span class="detail-label">Vehicle Make & Model</span><span class="detail-val">${a.vehicle}</span></div>
            <div class="detail-row"><span class="detail-label">Registration Number</span><span class="detail-val" style="font-family:var(--font-mono)">${a.reg}</span></div>
            <div class="detail-row"><span class="detail-label">Chassis Number</span><span class="detail-val" style="font-family:var(--font-mono)">${a.chassisNo || '—'}</span></div>
            <div class="detail-row"><span class="detail-label">Engine Number</span><span class="detail-val" style="font-family:var(--font-mono)">${a.engineNo || '—'}</span></div>
            <div class="detail-row"><span class="detail-label">Appraised Market Value</span><span class="detail-val">${FinEngine.kes(a.valuation)}</span></div>
            <div class="detail-row"><span class="detail-label">Forced Sale Value (FSV)</span><span class="detail-val">${FinEngine.kes(a.forcedSaleValue || a.valuation * 0.75)}</span></div>
            <div class="detail-row"><span class="detail-label">Loan-to-Value (LTV)</span><span class="detail-val" style="color:${ltv > 80 ? '#DC2626' : '#059669'}">${ltv}% ${ltv > 80 ? '(High)' : '(Acceptable)'}</span></div>
            <div class="detail-row"><span class="detail-label">Credit Bureau Grade</span><span class="detail-val" style="color:#0284C7">${a.creditScore?.grade || 'Grade B'} (Score: ${a.creditScore?.score || 710})</span></div>
          </div>
        </div>
      </div>

      ${data.activeRole === 'RISK_OFFICER' && ['BUY_OFF', 'ASSET_FINANCE'].includes(a.loanType || (a.hasBuyoff ? 'BUY_OFF' : 'ASSET_FINANCE')) ? `
      <div class="card" style="border:1px solid #BFDBFE;background:#EFF6FF">
        <div class="card-header">
          <div class="card-title-group">
            <i class="ti ti-file-certificate" style="color:#0284C7;font-size:18px"></i>
            <span class="card-title">Risk Undertaking</span>
          </div>
          <button class="btn btn-sm btn-primary" onclick="LOSModule.generateUndertaking('${a.id}')">
            <i class="ti ti-file-text"></i> Generate Undertaking
          </button>
        </div>
        <div class="card-body" style="font-size:12px;color:var(--text-secondary)">
          Generate a system undertaking from the ${a.loanType === 'BUY_OFF' ? 'buy-off' : 'asset finance'} details captured at intake. Review the populated document before issuing it.
        </div>
      </div>
      ` : ''}

      ${data.activeRole === 'RISK_OFFICER' && !['DISBURSED', 'REJECTED'].includes(a.status) ? `
      <div class="card" style="border:1px solid #CBD5E1;background:#F8FAFC">
        <div class="card-header">
          <div class="card-title-group">
            <i class="ti ti-shield-check" style="color:#7C3AED;font-size:17px"></i>
            <span class="card-title">Risk Verification Results</span>
          </div>
          <span class="badge" style="background:#F3E8FF;color:#6D28D9">Risk Officer only</span>
        </div>
        <div class="card-body" style="display:flex;gap:10px;flex-wrap:wrap">
          <button type="button" class="btn btn-sm" style="background:#E9CF45;border-color:#E9CF45;color:#172033" onclick="App.openRiskResultUpload('CRB', '${a.id}')">
            <i class="ti ti-upload"></i> Upload CRB Result
          </button>
          <button type="button" class="btn btn-sm" style="background:#5B55F6;border-color:#5B55F6;color:#fff" onclick="App.openRiskResultUpload('NTSA', '${a.id}')">
            <i class="ti ti-upload"></i> Upload NTSA Result
          </button>
          <button type="button" class="btn btn-sm btn-success" onclick="App.openInsuranceDebitNoteUpload('${a.id}')">
            <i class="ti ti-file-invoice"></i> Upload Insurance Debit Note
          </button>
        </div>
        ${a.insuranceDebitNote ? (() => {
          const allocation = this.insuranceAllocation(a);
          return `<div class="alert alert-info" style="margin:12px 0 0">
            <i class="ti ti-calculator"></i>
            <span><strong>Insurance allocation:</strong> ${FinEngine.kes(allocation.amount)} ÷ 3 = ${FinEngine.kes(allocation.feePortion)} each · Credit Admin fee ${FinEngine.kes(allocation.feePortion)} · Month 1 ${FinEngine.kes(allocation.monthOneAddition)} · Month 2 ${FinEngine.kes(allocation.monthTwoAddition)} · Total allocated ${FinEngine.kes(allocation.totalAllocated)}.</span>
          </div>`;
        })() : ''}
      </div>
      ` : ''}

      <div class="card kyc-documents-panel">
        <div class="card-header">
          <div class="card-title-group">
            <i class="ti ti-id-badge-2" style="color:var(--brand-accent);font-size:17px"></i>
            <span class="card-title">Borrower KYC &amp; Identity Documents</span>
            <span class="badge" style="background:#ECFDF5;color:#047857">${(a.documents || []).length} attached</span>
          </div>
        </div>
        <div class="card-body">
          ${this.renderKycDocumentCards(a.documents || [], a.id)}
        </div>
      </div>

      ${this.renderInteractionLog(a, linkedLoan)}

      <!-- Conditions Precedent (CPs) Checklist -->
      <div class="card">
        <div class="card-header">
          <div class="card-title-group">
            <span class="card-title">Conditions Precedent (CPs) & Document Compliance</span>
            <span class="badge" style="background:#F1F5F9;color:var(--text-secondary)">
              ${(a.conditions || []).filter(c => c.isMet).length} of ${(a.conditions || []).length} Satisfied
            </span>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
            ${data.activeRole === 'CREDIT_RISK_MANAGER' && a.status === 'PENDING_APPROVAL' ? `
            <button class="btn btn-sm btn-accent" onclick="LOSModule.showConditionsForm('${a.id}')">
              <i class="ti ti-plus"></i> Add Condition
            </button>` : ''}
            ${showServicing ? `
            <button class="btn btn-sm btn-primary" onclick="LOSModule.openLogbookCalculator('${a.id}')">
              <i class="ti ti-calendar-stats"></i> Schedule, Arrears &amp; Statement
            </button>` : ''}
            ${a.approvedAmount && this.canGenerateOfferLetter() ? `
            <button class="btn btn-sm btn-accent" onclick="LOSModule.printOfferLetter('${a.id}')">
              <i class="ti ti-printer"></i> Generate Offer Letter
            </button>
          ` : ''}
            ${data.activeRole === 'BRANCH_ADMIN' && this.generatedOfferLetter(a) ? `
            <button class="btn btn-sm btn-primary" onclick="LOSModule.viewGeneratedOfferLetter('${a.id}')">
              <i class="ti ti-eye"></i> View Generated Offer Letter
            </button>
          ` : ''}
          </div>
        </div>
        <div class="card-body">
          ${this.renderConditionEvidenceCards(a.conditions || [], a.id)}
          ${(a.conditions || []).length === 0 ? `
            <div style="font-size:12px;color:var(--text-secondary);padding:6px 0">
              Conditions Precedent have not been issued yet. They will be defined by the Credit Risk Manager during First-Level Approval.
            </div>
          ` : `
            <div class="cp-checklist">
              ${a.conditions.map(c => `
                <div class="cond-item">
                  <div class="cond-left">
                    <input type="checkbox" class="cond-check" ${c.isMet ? 'checked' : ''}
                      onchange="LOSModule.toggleCondition('${a.id}', '${c.id}', this.checked)"
                      ${data.activeRole !== 'RISK_OFFICER' && data.activeRole !== 'BRANCH_ADMIN' && data.activeRole !== 'OVERALL_ADMIN' && data.activeRole !== 'SUPER_ADMIN' ? 'disabled' : ''}>
                    <div>
                      <div class="${c.isMet ? 'cond-met' : 'cond-unmet'}">${c.label}</div>
                      ${c.evidence ? `<div style="font-size:10.5px;color:#059669"><i class="ti ti-file-check"></i> File: ${c.evidence}</div>` : '<div style="font-size:10.5px;color:var(--text-tertiary)">Pending document upload</div>'}
                    </div>
                  </div>
                  ${c.evidence ? `
                    <button class="btn btn-sm" onclick="LOSModule.previewConditionEvidence('${a.id}', '${c.id}')">
                      <i class="ti ti-file-search"></i> Preview
                    </button>
                    ${(data.activeRole === 'BRANCH_ADMIN' || data.activeRole === 'SUPER_ADMIN') ? `
                      <button class="btn btn-sm btn-accent" onclick="LOSModule.uploadConditionEvidence('${a.id}', '${c.id}')">
                        <i class="ti ti-refresh"></i> Replace
                      </button>
                    ` : ''}
                  ` : ((data.activeRole === 'BRANCH_ADMIN' || data.activeRole === 'SUPER_ADMIN') ? `
                    <button class="btn btn-sm btn-accent" onclick="LOSModule.uploadConditionEvidence('${a.id}', '${c.id}')">
                      <i class="ti ti-upload"></i> Upload File
                    </button>
                  ` : '')}
                </div>
              `).join('')}
            </div>
          `}
        </div>
      </div>

      <!-- Action Panel for Current Role -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">Role Actions (${data.roles[data.activeRole]?.title})</span>
          <span style="font-size:11px;color:var(--text-secondary)">Status: <strong>${a.status.replace(/_/g, ' ')}</strong></span>
        </div>
        <div class="card-body">
          ${canAct.length === 0 ? `
            <div class="alert alert-info" style="margin:0">
              <i class="ti ti-info-circle"></i>
              <span>No pending action required for your current role (${data.roles[data.activeRole]?.title}). Current stage is assigned to: <strong>${a.assignedRole ? (data.roles[a.assignedRole]?.title || a.assignedRole) : 'Completed'}</strong>.</span>
            </div>
          ` : `
            <div style="display:flex;gap:10px;flex-wrap:wrap">
              ${canAct.map(ac => `
                <button class="btn ${ac.cls || 'btn-primary'}" onclick="${ac.fn}">
                  ${ac.label}
                </button>
              `).join('')}
            </div>
            <div id="action-dynamic-form" style="margin-top:1rem"></div>
          `}
        </div>
      </div>

      <!-- Immutable Audit Trail -->
      <div class="card">
        <div class="card-header"><span class="card-title">Immutable Audit Trail</span></div>
        <div class="card-body" style="padding-top:0.5rem">
          ${(a.audit || []).map(entry => `
            <div class="detail-row" style="padding:8px 0;align-items:flex-start">
              <div>
                <div style="font-weight:600;font-size:12px">${entry.action}</div>
                <div style="font-size:11px;color:var(--text-secondary)">By: ${entry.by}</div>
              </div>
              <div style="font-family:var(--font-mono);font-size:11px;color:var(--text-tertiary)" title="${entry.at}">${typeof App !== 'undefined' && App.timeAgoFromString ? App.timeAgoFromString(entry.at) : entry.at}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    App.showTab('application-detail', { skipDetail: true });
  },

  getPermittedActions(a, role) {
    const acts = [];
    if (role === 'SUPER_ADMIN') {
      const allActions = ['RISK_OFFICER', 'CREDIT_RISK_MANAGER', 'CEO_COMMITTEE', 'BRANCH_ADMIN', 'CREDIT_ADMIN', 'FINANCE_OFFICER', 'FINANCE_MANAGER']
        .flatMap(r => this.getPermittedActions(a, r));
      return [...new Map(allActions.map(action => [action.fn, action])).values()];
    }
    if (role === 'RISK_OFFICER' && ['RISK_REVIEW', 'SUBMITTED'].includes(a.status)) {
      acts.push({ label: '✓ Recommend Approval & Forward to CRM', cls: 'btn-success', fn: `LOSModule.transition('${a.id}', 'risk_forward')` });
      acts.push({ label: '↩ Return to Branch Admin for Corrections', cls: 'btn-danger', fn: `LOSModule.transition('${a.id}', 'risk_return')` });
      acts.push({ label: '✗ Recommend Rejection', cls: 'btn-danger', fn: `LOSModule.transition('${a.id}', 'risk_reject')` });
    }

    if (role === 'CREDIT_RISK_MANAGER' && a.status === 'PENDING_APPROVAL') {
      acts.push({ label: '📝 Approve in Principle & Set Terms/CPs', cls: 'btn-accent', fn: `LOSModule.showConditionsForm('${a.id}')` });
      acts.push({ label: '↩ Return for Field Clarification', cls: '', fn: `LOSModule.transition('${a.id}', 'crm_return')` });
      acts.push({ label: '✗ Reject Application', cls: 'btn-danger', fn: `LOSModule.transition('${a.id}', 'crm_reject')` });
    }

    if (role === 'CEO_COMMITTEE' && a.isEscalated && a.status === 'PENDING_APPROVAL') {
      acts.push({ label: '🏛️ Committee / CEO Approval', cls: 'btn-success', fn: `LOSModule.showCommitteeDecisionForm('${a.id}', 'approve')` });
      acts.push({ label: '✗ Committee Rejection', cls: 'btn-danger', fn: `LOSModule.showCommitteeDecisionForm('${a.id}', 'reject')` });
    }

    if ((role === 'BRANCH_ADMIN' || role === 'SUPER_ADMIN') && (a.status === 'CONDITIONS_SET' || a.status === 'CONDITIONS_UPLOADED')) {
      acts.push({ label: '📤 Submit All Uploaded CPs for Risk Checking', cls: 'btn-primary', fn: `LOSModule.transition('${a.id}', 'conditions_upload')` });
    }

    if (role === 'RISK_OFFICER' && a.status === 'CONDITIONS_UPLOADED') {
      acts.push({ label: '✓ Confirm All Conditions Precedent Met', cls: 'btn-success', fn: `LOSModule.transition('${a.id}', 'conditions_met')` });
      acts.push({ label: '↩ Reject CPs — Evidence Inadequate', cls: 'btn-danger', fn: `LOSModule.transition('${a.id}', 'conditions_not_met')` });
    }

    if (role === 'CREDIT_ADMIN' && a.status === 'CONDITIONS_SET') {
      acts.push({ label: '📚 Book Facility & Capture Fees', cls: 'btn-primary', fn: `LOSModule.showBookingFeesForm('${a.id}')` });
    }

    if ((role === 'BRANCH_ADMIN' || role === 'SUPER_ADMIN') && a.status === 'LOAN_BOOKING') {
      acts.push({ label: '📤 Submit Uploaded CPs for Risk Checking', cls: 'btn-primary', fn: `LOSModule.transition('${a.id}', 'conditions_upload')` });
    }

    if (role === 'CREDIT_RISK_MANAGER' && a.status === 'CONDITIONS_MET') {
      acts.push({ label: '✓ Grant Final Facility Approval', cls: 'btn-success', fn: `LOSModule.transition('${a.id}', 'final_approve')` });
      acts.push({ label: '↩ Return to Credit Admin', cls: '', fn: `LOSModule.transition('${a.id}', 'final_return')` });
    }

    if (role === 'FINANCE_OFFICER' && a.status === 'FINAL_APPROVED') {
      acts.push({ label: '💵 Prepare Payment Voucher (PV)', cls: 'btn-primary', fn: `LOSModule.transition('${a.id}', 'prepare_voucher')` });
    }

    if (role === 'FINANCE_MANAGER' && a.status === 'VOUCHER_PREPARED') {
      acts.push({ label: '🚀 Authorize Disbursement & Handover to LMS', cls: 'btn-success', fn: `LOSModule.transition('${a.id}', 'authorize_disburse')` });
      acts.push({ label: '↩ Return Voucher for Amendment', cls: 'btn-danger', fn: `LOSModule.transition('${a.id}', 'return_voucher')` });
    }

    return acts;
  },

  showCommitteeDecisionForm(id, decision) {
    const data = DataStore.get();
    const a = (data.applications || []).find(x => x.id === id);
    if (!a || data.activeRole !== 'CEO_COMMITTEE' || !a.isEscalated || a.status !== 'PENDING_APPROVAL') return;

    const formEl = document.getElementById('action-dynamic-form');
    if (!formEl) return;

    const isApprove = decision === 'approve';
    formEl.innerHTML = `
      <div class="card" style="margin:0;padding:16px;background:#F8FAFC;border:1px solid #CBD5E1">
        <div class="section-label" style="margin-top:0">${isApprove ? 'CEO / Committee Approval' : 'CEO / Committee Rejection'}</div>
        <div class="fg" style="margin-bottom:12px">
          <label for="committee-decision-reason">${isApprove ? 'Approval rationale' : 'Rejection reason'} <span style="color:#DC2626">*</span></label>
          <textarea id="committee-decision-reason" rows="4" required placeholder="Capture the reason for this decision..."></textarea>
        </div>
        <button class="btn ${isApprove ? 'btn-success' : 'btn-danger'}" onclick="LOSModule.submitCommitteeDecision('${id}', '${decision}')">
          <i class="ti ti-check"></i> Confirm ${isApprove ? 'Approval' : 'Rejection'}
        </button>
      </div>
    `;
    document.getElementById('committee-decision-reason')?.focus();
  },

  submitCommitteeDecision(id, decision) {
    const reason = (document.getElementById('committee-decision-reason')?.value || '').trim();
    if (!reason) {
      alert(`Please capture the ${decision === 'approve' ? 'approval rationale' : 'rejection reason'} before continuing.`);
      return;
    }
    this.transition(id, decision === 'approve' ? 'committee_approve' : 'committee_reject', reason);
  },

  showBookingFeesForm(id) {
    const data = DataStore.get();
    const a = (data.applications || []).find(x => x.id === id);
    // Credit Admin receives the file immediately after CPs are issued.
    // The action panel exposes this form for CONDITIONS_SET applications.
    if (!a || data.activeRole !== 'CREDIT_ADMIN' || a.status !== 'CONDITIONS_SET') return;

    const principal = a.approvedAmount || a.amount || 0;
    const defaults = [
      { id: 'processing', name: 'Processing Fee', type: 'PERCENTAGE', rate: 4, amount: Math.round(principal * 0.04) },
      { id: 'risk_fund', name: 'Risk Fund', type: 'PERCENTAGE', rate: 2.5, amount: Math.round(principal * 0.025) },
      { id: 'joint_registration', name: 'Joint Registration', type: 'FIXED', rate: 6000, amount: 6000 },
      { id: 'bank_transfer', name: 'Bank Transfer', type: 'FIXED', rate: 1000, amount: 1000 },
      { id: 'crb_search', name: 'CRB Search', type: 'FIXED', rate: 1000, amount: 1000 },
      { id: 'ntsa_search', name: 'NTSA Search', type: 'FIXED', rate: 1000, amount: 1000 },
      { id: 'legal_fee', name: 'Legal Fee', type: 'FIXED', rate: 500, amount: 500 },
      { id: 'company_search', name: 'Company Search', type: 'FIXED', rate: 1000, amount: 1000 },
      { id: 'insurance', name: 'Comprehensive Insurance / TPO', type: 'FIXED', rate: 0, amount: 0 }
    ];
    // A captured debit note is chargeable for every facility type. The
    // Credit Admin one-third allocation is added to the worksheet and mapped
    // to the offer letter, including Buy-off facilities.
    const excludesInsurance = this.isInsuranceExcludedFacility(a);
    const insurance = this.insuranceAllocation(a);
    const feeSource = Array.isArray(a.deductibleFees) && a.deductibleFees.length ? a.deductibleFees : defaults;
    let fees = excludesInsurance
      ? feeSource.filter(f => String(f.id || f.name || '').toLowerCase() !== 'insurance' && !String(f.name || '').toLowerCase().includes('insurance'))
      : feeSource;
    if (insurance && !excludesInsurance && !fees.some(f => f.id === 'insurance_credit_admin'
      || /insurance\s*[—-]\s*credit administration fee/i.test(String(f.name || '')))) {
      fees = [...fees, {
        id: 'insurance_credit_admin',
        name: 'Insurance — Credit Administration Fee (1/3)',
        type: 'FIXED',
        rate: insurance.feePortion,
        amount: insurance.feePortion,
        applied: true
      }];
    }
    const esc = value => this.escapeHtml(value);
    const total = fees.filter(f => f.applied !== false).reduce((sum, f) => sum + (Number(f.amount) || 0), 0);

    const feeCategoryOptions = (type) => `
      <option value="FIXED" ${type !== 'PERCENTAGE' ? 'selected' : ''}>Fixed</option>
      <option value="PERCENTAGE" ${type === 'PERCENTAGE' ? 'selected' : ''}>Percentage</option>`;
    const formEl = document.getElementById('action-dynamic-form');
    if (!formEl) return;
    formEl.innerHTML = `
      <div class="card" style="margin:0;padding:16px;background:#FFFDF5;border:1px solid #FCD34D">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap">
          <div class="section-label" style="margin:0">5. Pre-disbursement deductible fees worksheet</div>
          <button type="button" class="btn btn-sm btn-accent" onclick="LOSModule.addCustomFeeRow()">+ Add Custom Fee Record</button>
        </div>
        <div id="booking-fees-list">
          ${fees.map((f, i) => `
            <div class="booking-fee-row" data-fee-index="${i}" style="display:grid;grid-template-columns:26px minmax(180px,1.4fr) 150px 105px 150px;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--border-light)">
              <input type="checkbox" class="booking-fee-apply" ${f.applied !== false ? 'checked' : ''} onchange="LOSModule.updateBookingFeesTotal()">
              <input class="booking-fee-name" type="text" value="${esc(f.name)}" aria-label="Fee name">
              <div style="display:flex;align-items:center;gap:4px">
                <select class="booking-fee-type" onchange="LOSModule.updateBookingFeeRow(this)">${feeCategoryOptions(f.type)}</select>
                <input class="booking-fee-rate" type="text" inputmode="decimal" value="${f.type === 'PERCENTAGE' ? (f.rate || 0) : (f.rate || 0)}" aria-label="Fee rate" oninput="LOSModule.updateBookingFeeRow(this)">
              </div>
              <span class="booking-fee-rate-label" style="font-size:11px;color:var(--text-secondary);text-align:right">${f.type === 'PERCENTAGE' ? `${f.rate || 0}%` : `KES ${Number(f.rate || 0).toLocaleString('en-KE')}`}</span>
              <label style="display:flex;align-items:center;gap:4px;justify-content:flex-end;font-size:11px">KES <input class="booking-fee-amount" type="text" inputmode="numeric" value="${Number(f.amount || 0).toLocaleString('en-KE')}" style="width:105px" oninput="LOSModule.formatAmountInput(this);LOSModule.updateBookingFeesTotal()"></label>
            </div>
          `).join('')}
        </div>
        <div id="custom-fee-rows"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px;font-weight:700">
          <div style="text-align:right">Gross approved loan principal:</div><div style="text-align:right">${FinEngine.kes(principal)}</div>
          <div style="text-align:right;color:#B91C1C">(-) Total deductible application fees:</div><div id="booking-fees-total" style="text-align:right;color:#B91C1C">${FinEngine.kes(total)}</div>
          <div style="text-align:right;color:#047857">(=) Net disbursed value:</div><div id="booking-fees-net" style="text-align:right;color:#047857">${FinEngine.kes(Math.max(0, principal - total))}</div>
        </div>
        <button type="button" class="btn btn-primary" style="margin-top:14px" onclick="LOSModule.saveBookingFees('${id}')"><i class="ti ti-check"></i> Save Fees &amp; Book Facility</button>
      </div>`;
  },

  addCustomFeeRow() {
    const box = document.getElementById('custom-fee-rows');
    if (!box) return;
    box.insertAdjacentHTML('beforeend', `
      <div class="booking-custom-fee" style="display:grid;grid-template-columns:26px minmax(180px,1.4fr) 150px 105px 150px;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--border-light)">
        <input type="checkbox" class="booking-fee-apply" checked onchange="LOSModule.updateBookingFeesTotal()">
        <input class="booking-custom-name booking-fee-name" type="text" placeholder="Custom fee name" required>
        <div style="display:flex;align-items:center;gap:4px">
          <select class="booking-fee-type" onchange="LOSModule.updateBookingFeeRow(this)">
            <option value="FIXED" selected>Fixed</option>
            <option value="PERCENTAGE">Percentage</option>
          </select>
          <input class="booking-fee-rate" type="text" inputmode="decimal" value="0" aria-label="Fee rate" oninput="LOSModule.updateBookingFeeRow(this)">
        </div>
        <span class="booking-fee-rate-label" style="font-size:11px;color:var(--text-secondary);text-align:right">KES 0</span>
        <label style="display:flex;align-items:center;gap:4px;justify-content:flex-end;font-size:11px">KES <input class="booking-fee-amount" type="text" inputmode="numeric" placeholder="0" oninput="LOSModule.formatAmountInput(this);LOSModule.updateBookingFeesTotal()"></label>
      </div>`);
    box.lastElementChild.querySelector('.booking-fee-name')?.focus();
  },

  updateBookingFeeRow(input) {
    const row = input?.closest('.booking-fee-row, .booking-custom-fee');
    if (!row) return;
    const type = row.querySelector('.booking-fee-type')?.value || 'FIXED';
    const rate = parseFloat(row.querySelector('.booking-fee-rate')?.value) || 0;
    const label = row.querySelector('.booking-fee-rate-label');
    if (label) label.textContent = type === 'PERCENTAGE' ? `${rate}%` : `KES ${rate.toLocaleString('en-KE')}`;

    // Percentage fees are calculated from the approved principal, while the
    // resulting amount remains editable for an authorised adjustment.
    if (type === 'PERCENTAGE') {
      const data = DataStore.get();
      const app = (data.applications || []).find(x => x.id === data.selectedAppId);
      const principal = app?.approvedAmount || app?.amount || 0;
      const amountInput = row.querySelector('.booking-fee-amount');
      if (amountInput && (input.classList.contains('booking-fee-type') || input.classList.contains('booking-fee-rate'))) {
        amountInput.value = Math.round(principal * rate / 100).toLocaleString('en-KE');
      }
    }
    this.updateBookingFeesTotal();
  },

  updateBookingFeesTotal() {
    const data = DataStore.get();
    const app = (data.applications || []).find(x => x.id === data.selectedAppId);
    const gross = app?.approvedAmount || app?.amount || 0;
    const total = [...document.querySelectorAll('#action-dynamic-form .booking-fee-row, #action-dynamic-form .booking-custom-fee')]
      .filter(row => row.querySelector('.booking-fee-apply')?.checked)
      .reduce((sum, row) => sum + (Number((row.querySelector('.booking-fee-amount')?.value || '').replace(/,/g, '')) || 0), 0);
    const totalEl = document.getElementById('booking-fees-total');
    const netEl = document.getElementById('booking-fees-net');
    if (totalEl) totalEl.textContent = FinEngine.kes(total);
    if (netEl) netEl.textContent = FinEngine.kes(Math.max(0, gross - total));
  },

  saveBookingFees(id) {
    const data = DataStore.get();
    const a = (data.applications || []).find(x => x.id === id);
    if (!a) return;
    const rows = [...document.querySelectorAll('#action-dynamic-form .booking-fee-row, #action-dynamic-form .booking-custom-fee')];
    const fees = rows.map(row => ({
      name: row.querySelector('.booking-fee-name, .booking-custom-name')?.value.trim() || 'Fee',
      type: row.querySelector('.booking-fee-type')?.value || 'FIXED',
      rate: parseFloat(row.querySelector('.booking-fee-rate')?.value) || 0,
      amount: Number((row.querySelector('.booking-fee-amount')?.value || '').replace(/,/g, '')) || 0,
      applied: !!row.querySelector('.booking-fee-apply')?.checked
    }));
    if (rows.some(row => row.classList.contains('booking-custom-fee') && !row.querySelector('.booking-custom-name')?.value.trim())) {
      alert('Enter a name for every custom fee record.');
      return;
    }
    const excludesInsurance = this.isInsuranceExcludedFacility(a);
    a.deductibleFees = excludesInsurance
      ? fees.filter(f => String(f.id || f.name || '').toLowerCase() !== 'insurance' && !String(f.name || '').toLowerCase().includes('insurance'))
      : fees;
    a.totalDeductibleFees = a.deductibleFees.filter(f => f.applied).reduce((sum, f) => sum + f.amount, 0);
    a.netDisbursedAmount = Math.max(0, (a.approvedAmount || a.amount || 0) - a.totalDeductibleFees);
    DataStore.save(data);
    this.transition(id, 'book_loan');
  },

  showConditionsForm(id) {
    const data = DataStore.get();
    const a = (data.applications || []).find(x => x.id === id);
    if (!a) return;

    const condList = [
      'Home visit & residence verification photos',
      'Personal guarantee executed with spouse/partner',
      'Corporate guarantee & board resolution to borrow',
      'Original Logbook deposited in Spectrum Safe Vault',
      'Joint NTSA TIMS caveat registration placed',
      'GPS Tracker installed with Rivertrack certificate',
      'Comprehensive insurance joint loss payee endorsement',
      'Sketch map to residence / business premise'
    ];

    const formEl = document.getElementById('action-dynamic-form');
    if (!formEl) return;

    formEl.innerHTML = `
      <div class="card" style="margin:0;padding:16px;background:#F8FAFC;border:1px solid #CBD5E1">
        <div class="section-label" style="margin-top:0">Define Facility Approval Terms</div>
        <div class="form-grid-3" style="margin-bottom:1rem">
          <div class="fg">
            <label>Approved Principal (KES)</label>
            <input type="number" id="ap-amt" value="${a.approvedAmount || a.amount}">
          </div>
          <div class="fg">
            <label>Tenor (Months)</label>
            <input type="number" id="ap-dur" value="${a.approvedDuration || a.requestedDuration || 12}">
          </div>
          <div class="fg">
            <label>Monthly Interest Rate (% p.m. flat)</label>
            <input type="number" id="ap-rate" value="${a.approvedRate || a.requestedRate || 5.0}" step="0.5">
          </div>
        </div>

        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;flex-wrap:wrap">
          <div class="section-label" style="margin:0">Select Mandatory Conditions Precedent (CPs)</div>
          <button type="button" class="btn btn-sm" onclick="LOSModule.addConditionOption()">
            <i class="ti ti-plus"></i> Add Condition
          </button>
        </div>
        <div id="condition-options" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
          ${condList.map((c, i) => `
            <label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer">
              <input type="checkbox" id="cond-chk-${i}" value="${c}" ${i < 4 ? 'checked' : ''}>
              ${c}
            </label>
          `).join('')}
        </div>
        <div id="custom-condition-box" style="display:none;max-width:650px;margin-bottom:1.25rem">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer">
              <input type="checkbox" id="cond-other-check">
              Other
            </label>
            <input id="cond-other-text" type="text" placeholder="Please specify…" style="flex:1;min-width:240px">
          </div>
        </div>

        <button class="btn btn-primary" onclick="LOSModule.saveConditionsAndApprove('${id}')">
          <i class="ti ti-check"></i> Issue Approval in Principle & Conditions Checklist
        </button>
      </div>
    `;
  },

  addConditionOption() {
    const box = document.getElementById('custom-condition-box');
    const check = document.getElementById('cond-other-check');
    const input = document.getElementById('cond-other-text');
    if (box) box.style.display = 'block';
    if (check) check.checked = true;
    input?.focus();
  },

  saveConditionsAndApprove(id) {
    const data = DataStore.get();
    const a = (data.applications || []).find(x => x.id === id);
    if (!a) return;

    a.approvedAmount = parseFloat(document.getElementById('ap-amt')?.value) || a.amount;
    a.approvedDuration = parseInt(document.getElementById('ap-dur')?.value) || 12;
    a.approvedRate = parseFloat(document.getElementById('ap-rate')?.value) || 5.0;

    const newConds = [];
    document.querySelectorAll('#condition-options input[type="checkbox"]').forEach((chk, i) => {
      if (chk.checked) {
        newConds.push({
          id: `c_${Date.now()}_${i}`,
          label: chk.value,
          isMet: false,
          evidence: ''
        });
      }
    });

    const otherChecked = document.getElementById('cond-other-check')?.checked;
    const otherText = (document.getElementById('cond-other-text')?.value || '').trim();
    if (otherChecked && !otherText) {
      alert('Please specify the custom condition before saving.');
      document.getElementById('cond-other-text')?.focus();
      return;
    }
    if (otherChecked && otherText) {
      newConds.push({
        id: `c_${Date.now()}_other`,
        label: otherText,
        isMet: false,
        evidence: ''
      });
    }

    if (!newConds.length) {
      alert('Please select at least one Condition Precedent before approving the facility.');
      return;
    }

    a.conditions = newConds;
    // Risk Manager issues CPs; Credit Admin books the facility next.
    a.status = 'CONDITIONS_SET';
    a.stage = 4;
    a.assignedRole = 'CREDIT_ADMIN';

    const today = new Date().toISOString().slice(0, 10);
    const nowTime = new Date().toTimeString().slice(0, 5);

    a.audit.push({
      action: `First approval granted. Terms: ${FinEngine.kes(a.approvedAmount)} @ ${a.approvedRate}% p.m., ${a.approvedDuration}m. ${newConds.length} conditions set. Ticket routed to Credit Admin for booking.`,
      by: `Credit Risk Manager (${data.activeRole})`,
      at: `${today} ${nowTime}`
    });

    data.notifications.push({
      id: Date.now(),
      role: 'CREDIT_ADMIN',
      message: `Facility terms and CPs set for ${id} (${a.customer}). Please book the facility.`,
      appId: id,
      time: `${today} ${nowTime}`,
      read: false
    });

    DataStore.save(data);
    this.openApplicationDetail(id);
  },

  uploadConditionEvidence(appId, condId) {
    const data = DataStore.get();
    const a = (data.applications || []).find(x => x.id === appId);
    const c = a?.conditions?.find(x => x.id === condId);
    if (!c || !['BRANCH_ADMIN', 'SUPER_ADMIN'].includes(data.activeRole)) return;

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp';
    input.style.display = 'none';
    document.body.appendChild(input);

    const cleanup = () => input.remove();
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) {
        cleanup();
        return;
      }
      if (!this.isAllowedDoc(file)) {
        alert('Please upload a PDF or image (JPG, PNG, WEBP).');
        cleanup();
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        alert('File is too large. Maximum size is 5 MB.');
        cleanup();
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        c.evidence = file.name;
        c.evidenceDocument = {
          id: `condition_doc_${Date.now()}`,
          name: file.name,
          type: file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : 'image/jpeg'),
          size: file.size,
          dataUrl: reader.result,
          uploadedAt: new Date().toISOString()
        };
        c.isMet = false; // Requires Risk Officer verification.

        // Uploading evidence does not change ownership. Branch Admin must
        // explicitly submit the completed CP package to Risk Officer.
        DataStore.save(data);
        cleanup();
        alert(`File "${file.name}" uploaded for condition: ${c.label}. Upload saved. Submit the completed conditions package when ready.`);
        this.openApplicationDetail(appId);
      };
      reader.onerror = () => {
        cleanup();
        alert('Could not read that file. Please try another copy.');
      };
      reader.readAsDataURL(file);
    }, { once: true });

    input.click();
  },

  previewConditionEvidence(appId, condId) {
    const data = DataStore.get();
    const condition = (data.applications || [])
      .find(x => x.id === appId)?.conditions?.find(x => x.id === condId);
    if (!condition) return;

    if (condition.evidenceDocument?.dataUrl) {
      this.openDocPreview({
        ...condition.evidenceDocument,
        label: condition.label
      });
      return;
    }
    alert(`${condition.evidence || 'Evidence file'} is attached, but its binary is not available in this browser session.`);
  },

  toggleCondition(appId, condId, checked) {
    const data = DataStore.get();
    const a = (data.applications || []).find(x => x.id === appId);
    const c = a?.conditions?.find(x => x.id === condId);
    if (c) {
      c.isMet = checked;
      if (checked && !c.evidence) c.evidence = 'verified_officer_signoff.pdf';

      const allConditionsMet = Array.isArray(a.conditions)
        && a.conditions.length > 0
        && a.conditions.every(condition => condition.isMet);

      if (allConditionsMet && data.activeRole === 'RISK_OFFICER') {
        const routedAt = new Date();
        const date = routedAt.toISOString().slice(0, 10);
        const time = routedAt.toTimeString().slice(0, 5);
        const timestamp = `${date} ${time}`;
        const alreadyRouted = a.status === 'CONDITIONS_MET'
          && a.assignedRole === 'CREDIT_RISK_MANAGER';

        a.status = 'CONDITIONS_MET';
        a.stage = 8;
        a.assignedRole = 'CREDIT_RISK_MANAGER';

        if (!alreadyRouted) {
          a.audit = a.audit || [];
          a.audit.push({
            action: 'All Conditions Precedent verified. Application routed to Credit Risk Manager for review.',
            by: data.roles[data.activeRole]?.title || data.activeRole,
            at: timestamp
          });
          data.notifications = data.notifications || [];
          data.notifications.push({
            id: Date.now(),
            role: 'CREDIT_RISK_MANAGER',
            message: `All Conditions Precedent are met for ${appId} (${a.customer}). Please review the facility.`,
            appId,
            time: timestamp,
            read: false
          });
        }
      }

      DataStore.save(data);
      this.openApplicationDetail(appId);
      this.renderApplicationsTable();
    }
  },

  transition(id, action, decisionReason = '') {
    const data = DataStore.get();
    const a = (data.applications || []).find(x => x.id === id);
    if (!a) return;

    const today = new Date().toISOString().slice(0, 10);
    const nowTime = new Date().toTimeString().slice(0, 5);
    const ts = `${today} ${nowTime}`;
    const roleTitle = data.roles[data.activeRole]?.title || data.activeRole;

    const transitions = {
      risk_forward: {
        status: a.isEscalated ? 'PENDING_APPROVAL' : 'PENDING_APPROVAL',
        stage: 3,
        assignedRole: a.isEscalated ? 'CEO_COMMITTEE' : 'CREDIT_RISK_MANAGER',
        log: 'Risk review completed — forwarded for approval',
        notify: a.isEscalated ? 'CEO_COMMITTEE' : 'CREDIT_RISK_MANAGER',
        msg: `Application ${id} pending approval`
      },
      risk_return: {
        status: 'SUBMITTED',
        stage: 1,
        assignedRole: 'BRANCH_ADMIN',
        log: 'Returned to Branch Admin for field correction',
        notify: 'BRANCH_ADMIN',
        msg: `Application ${id} returned for correction`
      },
      risk_reject: {
        status: 'REJECTED',
        stage: 2,
        assignedRole: null,
        log: 'Risk appraisal recommended rejection',
        notify: 'BRANCH_ADMIN',
        msg: `Application ${id} rejected by Risk Officer`
      },
      crm_return: {
        status: 'RISK_REVIEW',
        stage: 2,
        assignedRole: 'RISK_OFFICER',
        log: 'Credit Risk Manager returned for appraisal clarification',
        notify: 'RISK_OFFICER',
        msg: `Clarification requested on ${id}`
      },
      crm_reject: {
        status: 'REJECTED',
        stage: 3,
        assignedRole: null,
        log: 'Rejected by Credit Risk Manager',
        notify: 'BRANCH_ADMIN',
        msg: `Application ${id} declined by CRM`
      },
      committee_approve: {
        status: 'PENDING_APPROVAL',
        stage: 3,
        assignedRole: 'CREDIT_RISK_MANAGER',
        log: 'Committee / CEO approved high-value facility (> KES 2M)',
        notify: 'CREDIT_RISK_MANAGER',
        msg: `Committee approval granted for ${id}. CRM may now set terms.`
      },
      committee_reject: {
        status: 'REJECTED',
        stage: 3,
        assignedRole: null,
        log: 'Credit Committee rejected facility',
        notify: 'BRANCH_ADMIN',
        msg: `Committee rejected facility ${id}`
      },

      conditions_met: {
        status: 'CONDITIONS_MET',
        stage: 8,
        assignedRole: 'CREDIT_RISK_MANAGER',
        log: 'Risk Officer verified and certified all conditions precedent met',
        notify: 'CREDIT_RISK_MANAGER',
        msg: `Conditions fully satisfied for ${id}. Please approve the facility.`
      },
      conditions_not_met: {
        status: 'LOAN_BOOKING',
        stage: 6,
        assignedRole: 'BRANCH_ADMIN',
        log: 'Risk Officer found conditions inadequate — returned to Branch Admin',
        notify: 'BRANCH_ADMIN',
        msg: `Conditions rejected for ${id}. Re-upload required.`
      },
      book_loan: {
        status: 'LOAN_BOOKING',
        stage: 6,
        assignedRole: 'BRANCH_ADMIN',
        log: 'Credit Admin booked facility, generated amortization, assigned vault safe box',
        notify: 'BRANCH_ADMIN',
        msg: `Facility booked for ${id}. Upload and submit the Conditions Precedent.`
      },
      conditions_upload: {
        status: 'CONDITIONS_UPLOADED',
        stage: 7,
        assignedRole: 'RISK_OFFICER',
        log: 'Branch Admin uploaded condition evidence and submitted it for Risk Officer verification',
        notify: 'RISK_OFFICER',
        msg: `Condition evidence ready for Risk Officer verification on ${id}`
      },
      final_approve: {
        status: 'FINAL_APPROVED',
        stage: 9,
        assignedRole: 'FINANCE_OFFICER',
        log: 'Final facility approval signed off by Credit Risk Manager',
        notify: 'FINANCE_OFFICER',
        msg: `Final approval granted for ${id}. Prepare disbursement voucher.`
      },
      final_return: {
        status: 'LOAN_BOOKING',
        stage: 6,
        assignedRole: 'CREDIT_ADMIN',
        log: 'Final approval returned to Credit Admin for schedule review',
        notify: 'CREDIT_ADMIN',
        msg: `Schedule amendment requested on ${id}`
      },
      prepare_voucher: {
        status: 'VOUCHER_PREPARED',
        stage: 9,
        assignedRole: 'FINANCE_MANAGER',
        log: 'Finance Officer prepared Payment Voucher PV-2025-098 & validated bank details',
        notify: 'FINANCE_MANAGER',
        msg: `Payment Voucher pending disbursement authorization for ${id}`
      },
      authorize_disburse: {
        status: 'DISBURSED',
        stage: 10,
        assignedRole: null,
        log: 'Disbursement authorized by Finance Manager. Audit locked. Handed over to Core LMS.',
        notify: 'BRANCH_ADMIN',
        msg: `Facility ${id} successfully disbursed!`
      },
      return_voucher: {
        status: 'FINAL_APPROVED',
        stage: 8,
        assignedRole: 'FINANCE_OFFICER',
        log: 'Voucher returned for payment detail correction',
        notify: 'FINANCE_OFFICER',
        msg: `Payment Voucher correction needed on ${id}`
      }
    };

    const t = transitions[action];
    if (!t) return;

    if (['committee_approve', 'committee_reject'].includes(action) && !String(decisionReason || '').trim()) {
      alert('A CEO / Committee decision reason is required.');
      return;
    }

    a.status = t.status;
    a.stage = t.stage;
    a.assignedRole = t.assignedRole;
    const decisionText = action === 'committee_approve'
      ? `Approval rationale: ${String(decisionReason).trim()}`
      : action === 'committee_reject'
        ? `Rejection reason: ${String(decisionReason).trim()}`
        : '';
    a.audit.push({
      action: decisionText ? `${t.log}. ${decisionText}` : t.log,
      by: roleTitle,
      at: ts
    });

    if (t.status === 'CONDITIONS_MET' && a.conditions) {
      a.conditions.forEach(c => c.isMet = true);
    }

    if (t.status === 'LOAN_BOOKING' && !a.approvedAmount) {
      a.approvedAmount = a.amount;
      a.approvedDuration = a.requestedDuration || 12;
      a.approvedRate = a.requestedRate || 5.0;
    }

    // SPECIAL CASE: DISBURSED -> CREATE ACTIVE LOAN IN CORE LMS & GENERAL LEDGER
    if (t.status === 'DISBURSED') {
      this.handoverToCoreLMS(a, data, ts);
    }

    data.notifications.push({
      id: Date.now(),
      role: t.notify,
      message: decisionReason
        ? `${t.msg}. Decision ${action === 'committee_approve' ? 'rationale' : 'reason'}: ${String(decisionReason).trim()}`
        : t.msg,
      appId: id,
      time: ts,
      read: false
    });

    // CEO / Committee outcomes are explicitly routed to Risk Officer for follow-up.
    if (['committee_approve', 'committee_reject'].includes(action)) {
      data.notifications.push({
        id: Date.now() + 1,
        role: 'RISK_OFFICER',
        message: `CEO / Committee ${action === 'committee_approve' ? 'approved' : 'rejected'} ${id}. ${action === 'committee_approve' ? 'Proceed with risk follow-up.' : 'Review the rejection and update the risk file.'} Decision: ${String(decisionReason).trim()}`,
        appId: id,
        time: ts,
        read: false
      });
    }

    DataStore.save(data);
    this.openApplicationDetail(id);
    this.renderApplicationsTable();
    App.updateTopMetrics();
  },

  // Automated Handover to Core LMS upon Disbursement
  handoverToCoreLMS(app, data, timestamp) {
    const loanCount = (data.loans || []).length + 1;
    const accountNumber = `ACC-2025-${String(loanCount).padStart(4, '0')}`;
    const principal = app.approvedAmount || app.amount;
    const rate = app.approvedRate || app.requestedRate || 5.0;
    const tenor = app.approvedDuration || app.requestedDuration || 12;
    const trackingFee = app.trackingFee || 0;
    const disbDate = app.proposedDisbursementDate || new Date().toISOString().slice(0, 10);
    const quote = this.applyInsuranceToQuote(FinEngine.quoteLogbookFlat(principal, rate, tenor, trackingFee, disbDate, app.firstDueDate), app);
    const schedule = (quote?.schedule || []).map(row => ({
      period: row.n,
      dueDate: row.dueDate,
      installment: row.installment,
      principal: row.principal,
      interest: row.interest,
      tracking: row.tracking,
      balance: row.remainingPrincipal,
      status: 'PENDING',
      paidAmount: 0,
      paidDate: null,
      daysOverdue: 0
    }));

    const vaultId = `VAULT-0${(loanCount % 2) + 1}-R0${(loanCount % 4) + 1}-B${String(loanCount).padStart(2, '0')}`;
    const trackerId = `GPS-${Math.floor(10000 + Math.random() * 90000)}-TR`;

    // 1. Create LMS Active Loan
    const newLoan = {
      accountNumber,
      appId: app.id,
      customer: app.customer,
      phone: app.phone,
      idNumber: app.idNumber,
      vehicle: app.vehicle,
      reg: app.reg,
      valuation: app.valuation,
      disbursedAmount: principal,
      currentPrincipal: principal,
      approvedRate: rate,
      tenorMonths: tenor,
      amortizationMethod: 'FLAT',
      trackingFee,
      penaltyRate: app.penaltyRate || 5,
      graceDays: app.graceDays || 7,
      disbursementDate: disbDate,
      nextDueDate: schedule[0]?.dueDate || disbDate,
      daysPastDue: 0,
      parStatus: 'PAR_0',
      unpaidPenalties: 0,
      unpaidInterest: 0,
      totalPaid: 0,
      status: 'ACTIVE',
      collateralVaultId: vaultId,
      gpsTrackerId: trackerId,
      productId: app.productId || '',
      productName: app.productName || '',
      schedule,
      repaymentsHistory: []
    };

    data.loans = data.loans || [];
    data.loans.unshift(newLoan);

    // 2. Deposit Logbook in Safe Custody Vault
    data.collateralVault = data.collateralVault || [];
    data.collateralVault.unshift({
      vaultId,
      logbookNumber: `LOG-${app.reg.replace(/\s+/g, '')}-2025`,
      regNumber: app.reg,
      ownerName: app.customer,
      location: `Spectrum Central Vault, Unit ${vaultId}`,
      status: 'IN_CUSTODY',
      ntsaCaveatRef: `CAV-NTSA-2025-${Math.floor(1000 + Math.random() * 9000)}`,
      jointRegistrationDoc: `Joint_Reg_${app.reg.replace(/\s+/g, '')}.pdf`,
      dateDeposited: new Date().toISOString().slice(0, 10),
      custodian: 'Credit Admin — Custody Safe',
      gpsDetails: {
        unitId: trackerId,
        provider: 'Rivertrack Telematics Kenya',
        simNumber: '+254 799 ' + Math.floor(100000 + Math.random() * 900000),
        lastPing: 'Just now',
        batteryPct: 99,
        engineStatus: 'ENGINE_OFF',
        currentLocation: 'Spectrum Head Office, Westlands, Nairobi',
        immobilizerState: 'DISENGAGED'
      }
    });

    // 3. Post Double-Entry Accounting General Ledger Entry
    data.generalLedger = data.generalLedger || [];
    data.generalLedger.unshift({
      id: `JRN-${Date.now().toString().slice(-6)}`,
      date: timestamp,
      description: `Disbursement of facility ${app.id} (${app.customer}) to LMS Account ${accountNumber}`,
      debitAccount: '1200 - Loans Receivable (Asset)',
      debitAmount: principal,
      creditAccount: '1010 - Bank Operating NCBA (Asset)',
      creditAmount: principal,
      refId: app.id
    });
  },

  generateUndertaking(id) {
    const data = DataStore.get();
    const a = (data.applications || []).find(x => x.id === id);
    if (!a || !['RISK_OFFICER', 'SUPER_ADMIN'].includes(data.activeRole)) {
      alert('Only the Risk Officer can generate an undertaking from the application file.');
      return;
    }
    if (!['BUY_OFF', 'ASSET_FINANCE'].includes(a.loanType)) {
      alert('Undertakings are available for Buy-off and Asset Finance applications.');
      return;
    }

    const modal = document.getElementById('offer-letter-modal');
    const content = document.getElementById('offer-letter-content');
    if (!modal || !content) return;
    const title = modal.querySelector('.modal-title');
    if (title) title.innerHTML = '<i class="ti ti-file-certificate"></i> Risk Undertaking';

    const esc = (value) => String(value ?? '—')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    const row = (label, value) => `<tr><td style="font-weight:600;width:220px">${esc(label)}</td><td>${esc(value || '—')}</td></tr>`;
    const loanType = a.loanType || (a.hasBuyoff ? 'BUY_OFF' : 'ASSET_FINANCE');
    const typeLabel = loanType === 'BUY_OFF' ? 'BUY-OFF / REFINANCING' : 'ASSET FINANCE';
    const details = loanType === 'BUY_OFF' ? (a.buyoffDetails || {}) : (a.assetFinanceDetails || {});
    const rows = loanType === 'BUY_OFF' ? [
      row('Company Name', details.companyName),
      row('Company Address', details.address),
      row('Town', details.town),
      row('Client Names', details.clientNames),
      row('Motor Vehicle Registration No.', details.vehicleReg || a.reg),
      row('ID Number', details.idNumber || a.idNumber),
      row('KRA PIN', details.kraPin || a.kraPin),
      row('Lender', details.lender),
      row('Buy-off Payoff Amount', details.buyoffAmt ? FinEngine.kes(details.buyoffAmt) : '—')
    ] : [
      row('Seller Name', details.sellerName),
      row('Seller Address as per KRA', details.sellerAddress),
      row('Seller Town', details.sellerTown),
      row('Client Name', details.clientName || a.customer),
      row('Client KRA PIN', details.clientKraPin || a.kraPin),
      row('Motor Vehicle Registration No.', a.reg)
    ];

    const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    const isAssetFinance = loanType === 'ASSET_FINANCE';
    const documentTitle = isAssetFinance
      ? 'ASSET FINANCE UNDERTAKING / AUTHORITY TO PAY SELLER'
      : 'BUY-OFF UNDERTAKING / AUTHORITY TO SETTLE LENDER';
    const undertakingText = isAssetFinance
      ? `We hereby undertake to finance the purchase of the asset described below and to pay the approved purchase consideration to the named seller, subject to the approved facility terms, satisfactory verification of the seller and asset, and completion of all required security and transfer documentation.`
      : `We hereby undertake to settle the outstanding amount due to the named lender in respect of the buy-off facility described below, subject to the approved facility terms, satisfactory verification and completion of the required discharge, transfer and security documentation.`;
    const documentHtml = `
      <div style="text-align:center;border-bottom:2px solid #0F172A;padding-bottom:12px;margin-bottom:16px">
        <div style="font-size:20px;font-weight:800;color:#0F172A;letter-spacing:1px">SPECTRUM CREDIT LIMITED</div>
        <div style="font-size:11px;color:#475569">${documentTitle}</div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:16px;font-size:12px">
        <div><strong>DATE:</strong> ${today}<br><strong>APPLICATION:</strong> ${esc(a.id)}<br><strong>BORROWER / CLIENT:</strong> ${esc(a.customer)}</div>
        <div style="text-align:right"><strong>VEHICLE:</strong> ${esc(a.vehicle)}<br><strong>REGISTRATION:</strong> ${esc(a.reg)}</div>
      </div>
      <div style="font-size:12px;line-height:1.6;margin:12px 0">
        <strong>To:</strong> ${esc(isAssetFinance ? details.sellerName : details.companyName)}<br>
        ${esc(isAssetFinance ? details.sellerAddress : details.address)}<br>
        ${esc(isAssetFinance ? details.sellerTown : details.town)}
      </div>
      <p style="font-size:12px;line-height:1.6">
        Dear Sir/Madam,<br><br>${undertakingText}
      </p>
      <div style="font-size:12px;font-weight:700;text-transform:uppercase;margin-top:18px">Facility and transaction details</div>
      <table class="tbl" style="margin:8px 0 16px;border:1px solid #CBD5E1"><tbody>${rows.join('')}</tbody></table>
      <div style="font-size:12px;line-height:1.6;margin-top:14px">
        ${isAssetFinance
          ? '<strong>Payment and delivery instruction:</strong> Upon disbursement and satisfaction of the applicable conditions, payment shall be processed to the seller named above for the approved asset purchase. The seller shall provide the required ownership, transfer, clearance and delivery documents.'
          : '<strong>Settlement instruction:</strong> Upon disbursement and satisfaction of the applicable conditions, settlement shall be processed to the lender named above. The lender shall provide the required payoff, discharge and transfer documents.'}
      </div>
      <div style="font-size:12px;line-height:1.6;margin-top:14px">
        <strong>Risk Officer undertaking:</strong> The above details have been reviewed against the application file. Any discrepancy, missing evidence or adverse verification must be recorded and resolved before the facility proceeds. This undertaking is issued for this transaction only and does not vary the facility agreement or security documents.
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:50px;padding-top:18px;border-top:1px solid #E2E8F0">
        <div><div style="border-bottom:1px solid #000;width:190px;height:30px"></div><div style="font-size:11px;font-weight:600;margin-top:4px">For: Spectrum Credit Limited<br>Risk Officer Signature</div></div>
        <div><div style="border-bottom:1px solid #000;width:190px;height:30px"></div><div style="font-size:11px;font-weight:600;margin-top:4px">${isAssetFinance ? 'Seller Acknowledgement' : 'Lender Acknowledgement'}<br>Name / Signature / Stamp</div></div>
      </div>
    `;

    if (this._undertakingDownloadUrl) {
      URL.revokeObjectURL(this._undertakingDownloadUrl);
    }
    this._undertakingDownloadUrl = URL.createObjectURL(
      new Blob([documentHtml], { type: 'text/html;charset=utf-8' })
    );
    const downloadName = `${a.id}_${loanType.toLowerCase()}_undertaking.html`;
    const generatedAt = new Date().toISOString();
    a.undertaking = {
      type: loanType,
      title: documentTitle,
      name: downloadName,
      recipient: isAssetFinance ? details.sellerName : details.companyName,
      generatedAt
    };
    a.audit = Array.isArray(a.audit) ? a.audit : [];
    a.audit.unshift({
      action: `${documentTitle} generated`,
      by: data.roles[data.activeRole]?.title || data.activeRole,
      at: generatedAt.slice(0, 16).replace('T', ' ')
    });
    DataStore.save(data);
    // Use the same preview engine as uploaded HTML documents so the
    // generated undertaking has one reliable preview and download path.
    this.openDocPreview({
      id: `undertaking_${a.id}`,
      label: 'Risk Undertaking',
      name: downloadName,
      type: 'text/html;charset=utf-8',
      size: new Blob([documentHtml], { type: 'text/html;charset=utf-8' }).size,
      dataUrl: this._undertakingDownloadUrl
    });
  },

  printOfferLetter(id) {
    if (!this.canGenerateOfferLetter()) {
      alert('Only Credit Admin can generate offer letters.');
      return;
    }

    const data = DataStore.get();
    const a = (data.applications || []).find(x => x.id === id);
    if (!a) return;

    // Generating the offer letter hands the file back to the originating
    // Branch Admin for customer acceptance and the remaining pre-disbursement
    // follow-up. Keep the current approval status/stage unchanged.
    if (a.assignedRole !== 'BRANCH_ADMIN' || !a.offerLetterGeneratedAt) {
      const generatedAt = new Date();
      const today = generatedAt.toISOString().slice(0, 10);
      const nowTime = generatedAt.toTimeString().slice(0, 5);
      a.assignedRole = 'BRANCH_ADMIN';
      a.offerLetterGeneratedAt = `${today} ${nowTime}`;
      a.offerLetterGeneratedBy = data.activeRole;
      a.audit = a.audit || [];
      a.audit.push({
        action: 'Official offer letter generated and file assigned to Branch Admin for customer acceptance',
        by: data.roles[data.activeRole]?.title || data.activeRole,
        at: a.offerLetterGeneratedAt
      });
      data.notifications = data.notifications || [];
      data.notifications.push({
        id: Date.now(),
        role: 'BRANCH_ADMIN',
        message: `Offer letter generated for ${id} (${a.customer}). Please obtain customer acceptance and complete branch follow-up.`,
        appId: id,
        time: a.offerLetterGeneratedAt,
        read: false
      });
      DataStore.save(data);
    }

    const modal = document.getElementById('offer-letter-modal');
    const content = document.getElementById('offer-letter-content');
    if (!modal || !content) return;
    const title = modal.querySelector('.modal-title');
    if (title) title.innerHTML = '<i class="ti ti-file-text"></i> Official Financial Document';

    const offerAmt = a.approvedAmount || a.amount;
    const offerRate = a.approvedRate || a.requestedRate || 5.0;
    const offerTenor = a.approvedDuration || a.requestedDuration || 12;
    const facilityType = a.loanType || (a.hasBuyoff ? 'BUY_OFF' : 'STRAIGHT_LOAN');
    const facilityTypeLabel = this.loanTypeLabel(facilityType);
    const isBuyOff = facilityType === 'BUY_OFF';
    // Straight Loan offer letters do not include insurance, even if an older
    // record happens to contain an insurance debit note or fee.
    // This offer-letter format is issued without insurance for every facility type.
    const excludesInsurance = true;
    const insuranceAllocation = null;
    const quoteApplication = { ...a, insuranceDebitNote: null };
    const quote = this.applyInsuranceToQuote(FinEngine.quoteLogbookFlat(
      offerAmt,
      offerRate,
      offerTenor,
      a.trackingFee || 0,
      a.proposedDisbursementDate || a.createdAt,
      a.firstDueDate
    ), quoteApplication);
    const monthlyEMI = quote?.installment || 0;
    const isInsuranceFee = fee => String(fee?.id || '').toLowerCase().includes('insurance')
      || String(fee?.name || '').toLowerCase().includes('insurance')
      || /risk.?fund/i.test(`${fee?.id || ''} ${fee?.name || ''}`);
    const baseDeductibleFees = Array.isArray(a.deductibleFees)
      ? a.deductibleFees.filter(f => f.applied !== false
        && !(insuranceAllocation && isInsuranceFee(f))
        && (!excludesInsurance || !isInsuranceFee(f)))
      : [];
    const hasInsuranceAdminFee = baseDeductibleFees.some(f => f.id === 'insurance_credit_admin'
      || /insurance\s*[—-]\s*credit administration fee/i.test(String(f.name || '')));
    const deductibleFees = insuranceAllocation && !excludesInsurance && !hasInsuranceAdminFee
      ? [...baseDeductibleFees, { id: 'insurance_credit_admin', name: 'Insurance — Credit Administration Fee (1/3)', type: 'FIXED', rate: insuranceAllocation.feePortion, amount: insuranceAllocation.feePortion, applied: true }]
      : baseDeductibleFees;
    const totalDeductibleFees = deductibleFees.reduce((sum, f) => sum + (Number(f.amount) || 0), 0);
    const netDisbursedAmount = Math.max(0, offerAmt - totalDeductibleFees);

    if (facilityType === 'STRAIGHT_LOAN') {
      const esc = value => this.escapeHtml(value ?? '');
      const formatDate = value => {
        const date = value ? new Date(`${String(value).slice(0, 10)}T00:00:00`) : new Date();
        if (Number.isNaN(date.getTime())) return '—';
        const day = date.getDate();
        const suffix = day % 10 === 1 && day !== 11 ? 'st' : day % 10 === 2 && day !== 12 ? 'nd' : day % 10 === 3 && day !== 13 ? 'rd' : 'th';
        return `${day}${suffix} ${date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}`;
      };
      const amountInWords = amount => {
        const small = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
        const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
        const underThousand = n => {
          if (n < 20) return small[n];
          if (n < 100) return `${tens[Math.floor(n / 10)]}${n % 10 ? `-${small[n % 10]}` : ''}`;
          return `${small[Math.floor(n / 100)]} hundred${n % 100 ? ` and ${underThousand(n % 100)}` : ''}`;
        };
        const integer = Math.max(0, Math.floor(Number(amount) || 0));
        if (integer < 1000) return underThousand(integer);
        if (integer < 1000000) return `${underThousand(Math.floor(integer / 1000))} thousand${integer % 1000 ? ` ${underThousand(integer % 1000)}` : ''}`;
        if (integer < 1000000000) return `${underThousand(Math.floor(integer / 1000000))} million${integer % 1000000 ? ` ${amountInWords(integer % 1000000)}` : ''}`;
        return String(integer);
      };
      const monthlyInstallment = quote?.schedule?.[0]?.installment || monthlyEMI;
      const processingFee = deductibleFees.find(f => /processing/i.test(`${f.id || ''} ${f.name || ''}`));
      const processingRate = processingFee?.type === 'PERCENTAGE' ? Number(processingFee.rate) || 4 : 4;
      const letterFees = deductibleFees.filter(f => !/insurance|risk fund/i.test(`${f.id || ''} ${f.name || ''}`));
      const feeSchedule = letterFees.length
        ? `<ul>${letterFees.map(f => `<li>${esc(f.name)}: ${FinEngine.kes(f.amount)}</li>`).join('')}</ul><p><strong>Total listed deductions:</strong> ${FinEngine.kes(letterFees.reduce((sum, fee) => sum + (Number(fee.amount) || 0), 0))}<br><strong>Estimated net disbursement:</strong> ${FinEngine.kes(Math.max(0, offerAmt - letterFees.reduce((sum, fee) => sum + (Number(fee.amount) || 0), 0)))}</p>`
        : '<p>No additional third-party fees have been recorded on this offer.</p>';
      const securityRegistration = esc(a.reg || '—');
      const loanPurpose = esc(a.purpose || 'Business working capital');
      const dueDay = quote?.firstDueDate ? formatDate(quote.firstDueDate) : '30 days from drawdown / disbursement';
      const letterDate = formatDate(new Date().toISOString());
      const principalWords = amountInWords(offerAmt).toUpperCase();
      const tenorWords = amountInWords(offerTenor);
      const tenorDescription = `${tenorWords.charAt(0).toUpperCase()}${tenorWords.slice(1)} (${offerTenor})`;
      content.innerHTML = `
        <article style="font:12px Arial,sans-serif;color:#172033;line-height:1.55;max-width:850px;margin:0 auto">
          <div style="text-align:right;font-weight:700;margin-bottom:14px">${letterDate}</div>
          <div style="margin-bottom:16px"><strong>${esc(a.customer)}</strong><br>${esc(a.postalAddress || '')}${a.town ? `<br>${esc(a.town.toUpperCase())}` : ''}</div>
          <p>Dear Sir,</p>
          <h3 style="font-size:14px;margin:16px 0">LOAN FACILITY KSH ${Number(offerAmt).toLocaleString('en-KE')} (${principalWords} SHILLINGS ONLY)</h3>
          <p>Your application dated ${formatDate(a.createdAt)} refers. It is our pleasure to confirm that we are prepared to grant you a loan of Kshs. ${Number(offerAmt).toLocaleString('en-KE')} for a maximum period of ${tenorDescription} month${offerTenor === 1 ? '' : 's'}, subject to the following terms and conditions.</p>
          <h4>PURPOSE</h4>
          <p>The facility has been granted for ${loanPurpose}. The whole loan amount shall be used only for the purpose set out herein. Spectrum Credit Limited shall have the right to demand immediate payment of any outstanding loan amount together with interest if it comes to our notice that any part of the loan has been or is being expended for another purpose.</p>
          <h4>AMOUNT</h4>
          <p>The maximum amount you can draw under this facility is Ksh ${Number(offerAmt).toLocaleString('en-KE')}.</p>
          <h4>TERMS AND CONDITIONS</h4>
          <ol>
            <li><strong>Interest</strong><br>Interest will be charged at the rate of ${offerRate}% per month on a flat-rate basis. Late payment will be charged at ${Number(a.penaltyRate) || 5}% per week on installment arrears, after a grace period of ${Number(a.graceDays) || 7} days. Any amendment to interest charges will be communicated in accordance with applicable law and the facility agreement.</li>
            <li><strong>Loan Application Fees</strong><br>The loan processing fee is ${processingRate}% of the principal, exclusive of applicable taxes. Other recorded third-party fees, as itemized below, shall be deducted from the loan amount on or before disbursement.${feeSchedule}</li>
            <li><strong>Security</strong><br>The facility will be secured by:<br>a) A security agreement / chattel mortgage over motor vehicle registration number ${securityRegistration}.<br>b) Joint registration between the Borrower or Guarantor and Spectrum Credit Limited over motor vehicle ${securityRegistration}.</li>
            <li><strong>Facility Sanction</strong><br>Security must be perfected before drawdown. All costs of perfecting the security, including searches, valuation, advocate fees, NTSA transfer fees and in-charge fees, shall be borne by the Borrower.</li>
            <li><strong>Buy-Off / Early Settlement</strong><br>Early settlement or buy-off shall be effected upon written request to Spectrum Credit Limited and calculated as follows:<br>a) Where the loan has run for more than twelve (12) months, the payoff amount shall comprise the outstanding principal balance only, if any.<br>b) Where the loan has run for less than twelve (12) months, the payoff amount shall comprise the outstanding principal balance plus fifty percent (50%) of the interest applicable to the remaining period up to twelve (12) months.</li>
            <li><strong>Disbursement</strong><br>Disbursement will be made upon completion of all legal formalities, including perfection and registration of securities. The loan will be disbursed directly to your account or nominated account by RTGS, net of applicable fees.</li>
            <li><strong>Repayment</strong><br>a) The facility shall be repaid in ${offerTenor} equal monthly installments of ${FinEngine.kes(monthlyInstallment)}. The first installment is due ${dueDay}; subsequent installments shall fall due monthly until the loan is paid in full.<br>b) Repayment may be made to SPECTRUM CREDIT LIMITED, Account No. 01148173434000, CO-OPERATIVE BANK, NAIROBI BUSINESS CENTRE, or through M-Pesa Paybill 311750, using the customer's ID number as the account number.<br>c) Each installment is payable in cleared funds, without deduction, on or before its due date. Partial, late or failed payments may attract applicable charges or penalty interest, without prejudice to other rights of Spectrum Credit Limited.</li>
            <li><strong>Other Terms and Conditions</strong><br>a) “You” or “Your” means the Borrower and/or Guarantor(s), jointly or severally.<br>b) This offer is open for acceptance within fourteen (14) days from the date of this letter. If not accepted unconditionally within that period, it will be deemed withdrawn.<br>c) The whole loan balance may become immediately due and payable, and Spectrum Credit Limited may exercise its rights over the collateral, subject to applicable law and the security documents, upon default in payment, failure to perfect security, suspected fraud or material misrepresentation, execution or distress against the Borrower or Guarantor, or any other material event prejudicing the security or repayment of the facility.<br>d) If the facility becomes due before the interest threshold described in the early settlement clause is met, any applicable difference may be included in the amount due, subject to the facility agreement and applicable law.<br>e) Where you nominate a bank account that is not in your name, you confirm that the nomination is voluntary, that you are aware of the account owner and beneficiaries, and that you authorize Spectrum Credit Limited to make payment to that account.</li>
          </ol>
          <p>Yours faithfully,<br><strong>For Spectrum Credit Limited</strong></p>
          <div style="display:flex;justify-content:space-between;gap:30px;margin-top:28px;page-break-inside:avoid">
            <div style="width:45%"><div style="border-bottom:1px solid #172033;height:32px"></div><strong>Loan Officer</strong><br>Date: ${letterDate}</div>
            <div style="width:45%"><div style="border-bottom:1px solid #172033;height:32px"></div><strong>Customer Signature</strong><br>${esc(a.customer)}<br>Date: __________________</div>
          </div>
          <div style="border-top:1px solid #CBD5E1;margin-top:24px;padding-top:8px;font-size:10px;color:#64748B">Offer letter · ${esc(a.id)} · Straight Loan · Insurance is not included in this facility offer.</div>
        </article>`;
    } else {
      content.innerHTML = `
      <div style="text-align:center;border-bottom:2px solid #0F172A;padding-bottom:12px;margin-bottom:16px">
        <div style="font-size:20px;font-weight:800;color:#0F172A;letter-spacing:1px">SPECTRUM CREDIT LIMITED</div>
        <div style="font-size:11px;color:#475569">Logbook & Asset Financing Specialists · P.O Box 48921-00100 Nairobi, Kenya</div>
        <div style="font-size:11px;color:#475569">Tel: +254 20 765 4321 · Email: credit@spectrumcredit.co.ke</div>
      </div>

      <div style="display:flex;justify-content:space-between;margin-bottom:16px">
        <div>
          <strong>DATE:</strong> ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}<br>
          <strong>TO:</strong> ${a.customer}<br>
          <strong>ID NO:</strong> ${a.idNumber || '—'} · <strong>KRA PIN:</strong> ${a.kraPin || '—'}<br>
          <strong>PHONE:</strong> ${a.phone}
        </div>
        <div style="text-align:right">
          <strong>FACILITY REF:</strong> <span style="font-family:var(--font-mono)">${a.id}</span><br>
          <strong>SECURITY:</strong> ${a.vehicle} (${a.reg})
        </div>
      </div>

      <div style="font-size:14px;font-weight:700;margin-bottom:10px;text-transform:uppercase;color:#0F172A">
        RE: CONDITIONAL LETTER OF OFFER — ${facilityTypeLabel.toUpperCase()} FACILITY
      </div>

      <p style="font-size:12px;margin-bottom:12px">
        We are pleased to advise that Spectrum Credit Limited has approved your application for a ${facilityTypeLabel.toLowerCase()} facility subject to the terms and conditions outlined below:
      </p>

      <table class="tbl" style="margin-bottom:16px;border:1px solid #CBD5E1">
        <tr><td style="font-weight:600;width:200px">Facility Type:</td><td>${facilityTypeLabel}</td></tr>
        ${facilityType === 'STRAIGHT_LOAN' ? '<tr><td style="font-weight:600">Insurance:</td><td>Not included in this offer</td></tr>' : ''}
        <tr><td style="font-weight:600">Approved Facility Amount:</td><td><strong>${FinEngine.kes(offerAmt)}</strong></td></tr>
        ${deductibleFees.length ? `
        <tr><td style="font-weight:600;vertical-align:top">Pre-disbursement deductible fees:</td><td>
          ${deductibleFees.map(f => `<div style="display:flex;justify-content:space-between;gap:20px"><span>${this.escapeHtml(f.id === 'insurance_credit_admin' || /insurance\s*[—-]\s*credit administration fee/i.test(String(f.name || '')) ? 'Insurance' : f.name)}${f.type === 'PERCENTAGE' ? ` <small style="color:#64748B">(${f.rate || 0}%)</small>` : ''}</span><strong>${FinEngine.kes(f.amount)}</strong></div>`).join('')}
          <div style="display:flex;justify-content:space-between;gap:20px;border-top:1px solid #CBD5E1;margin-top:6px;padding-top:6px;color:#B91C1C"><span>Total deductible fees</span><strong>${FinEngine.kes(totalDeductibleFees)}</strong></div>
          <div style="display:flex;justify-content:space-between;gap:20px;color:#047857"><span>Net disbursed value</span><strong>${FinEngine.kes(netDisbursedAmount)}</strong></div>
        </td></tr>
        ` : ''}
        <tr><td style="font-weight:600">Facility Tenor:</td><td>${offerTenor} Calendar Months</td></tr>
        <tr><td style="font-weight:600">Interest Rate:</td><td>${offerRate}% per month (flat logbook basis)</td></tr>
        <tr><td style="font-weight:600">Monthly Installment:</td><td><strong>${FinEngine.kes(monthlyEMI)}</strong>${insuranceAllocation && !excludesInsurance ? `<div style="font-size:10.5px;color:#64748B;margin-top:3px">Includes insurance additions: Month 1 ${FinEngine.kes(insuranceAllocation.monthOneAddition)} and Month 2 ${FinEngine.kes(insuranceAllocation.monthTwoAddition)}</div>` : ''}</td></tr>
        ${quote ? `<tr><td style="font-weight:600">On-time total payable:</td><td>${FinEngine.kes(quote.totalPayable)}</td></tr>` : ''}
        <tr><td style="font-weight:600">Repayment Channel:</td><td>M-Pesa Paybill 400200 / NCBA Bank Transfer</td></tr>
        <tr><td style="font-weight:600">Collateral / Asset:</td><td>Motor Vehicle Reg: <strong>${a.reg}</strong> (${a.vehicle})</td></tr>
        <tr><td style="font-weight:600">Agreed Forced Sale Value:</td><td>${FinEngine.kes(a.forcedSaleValue || a.valuation * 0.75)}</td></tr>
      </table>

      <div style="display:flex;justify-content:space-between;margin-top:30px;padding-top:20px;border-top:1px solid #E2E8F0">
        <div>
          <div style="border-bottom:1px solid #000;width:180px;height:30px"></div>
          <div style="font-size:11px;font-weight:600;margin-top:4px">Authorized Signatory</div>
          <div style="font-size:10px;color:#64748B">Credit Risk Manager — Spectrum Credit</div>
        </div>
        <div>
          <div style="border-bottom:1px solid #000;width:180px;height:30px"></div>
          <div style="font-size:11px;font-weight:600;margin-top:4px">Borrower Acceptance & Signature</div>
          <div style="font-size:10px;color:#64748B">${a.customer} (I accept terms)</div>
        </div>
      </div>
    `;
    }

    if (facilityType !== 'STRAIGHT_LOAN') {
      const esc = value => this.escapeHtml(value ?? '—');
      const ordinalDate = value => {
        const date = value ? new Date(`${String(value).slice(0, 10)}T00:00:00`) : new Date();
        if (Number.isNaN(date.getTime())) return '—';
        const day = date.getDate();
        const suffix = day % 10 === 1 && day !== 11 ? 'st' : day % 10 === 2 && day !== 12 ? 'nd' : day % 10 === 3 && day !== 13 ? 'rd' : 'th';
        return `${String(day).padStart(2, '0')}${suffix} ${date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}`;
      };
      const numberWords = amount => {
        const small = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
        const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
        const underThousand = n => n < 20 ? small[n] : n < 100
          ? `${tens[Math.floor(n / 10)]}${n % 10 ? `-${small[n % 10]}` : ''}`
          : `${small[Math.floor(n / 100)]} hundred${n % 100 ? ` and ${underThousand(n % 100)}` : ''}`;
        const n = Math.max(0, Math.floor(Number(amount) || 0));
        if (n < 1000) return underThousand(n);
        if (n < 1000000) return `${underThousand(Math.floor(n / 1000))} thousand${n % 1000 ? ` ${underThousand(n % 1000)}` : ''}`;
        if (n < 1000000000) return `${underThousand(Math.floor(n / 1000000))} million${n % 1000000 ? ` ${numberWords(n % 1000000)}` : ''}`;
        return String(n);
      };
      const dateIssued = ordinalDate(new Date().toISOString());
      const applicationDate = ordinalDate(a.createdAt);
      const purpose = a.purpose || facilityTypeLabel;
      const installment = quote?.schedule?.[0]?.installment || monthlyEMI;
      const installmentDate = quote?.firstDueDate ? ordinalDate(quote.firstDueDate) : '30 days from drawdown/disbursement';
      const processingFee = deductibleFees.find(f => /processing/i.test(`${f.id || ''} ${f.name || ''}`));
      const processingRate = processingFee?.type === 'PERCENTAGE' ? Number(processingFee.rate) || 4 : 4;
      const feeRows = deductibleFees.length
        ? deductibleFees.map(f => `<tr><td>${esc(f.name)}${f.type === 'PERCENTAGE' ? ` (${esc(f.rate || 0)}%)` : ''}</td><td class="amount">${FinEngine.kes(f.amount)}</td></tr>`).join('')
        : '<tr><td colspan="2">No additional third-party fees recorded.</td></tr>';
      const facilityDetail = facilityType === 'BUY_OFF' ? (a.buyoffDetails || {}) : (a.assetFinanceDetails || {});
      const counterparty = facilityType === 'BUY_OFF' ? facilityDetail.companyName || facilityDetail.lender : facilityDetail.sellerName;
      const registration = facilityType === 'BUY_OFF' ? facilityDetail.vehicleReg || a.reg : a.reg;
      const feeTotal = deductibleFees.reduce((sum, fee) => sum + (Number(fee.amount) || 0), 0);
      const netAmount = Math.max(0, offerAmt - feeTotal);
      const termWords = numberWords(offerTenor);
      const borrowerAddress = [a.postalAddress, a.town].filter(Boolean).map(esc).join('<br>');

      content.innerHTML = `
        <article class="offer-letter" style="font:12px Arial,sans-serif;color:#172033;line-height:1.55;max-width:850px;margin:0 auto">
          <style>.offer-letter h3{font-size:14px;margin:18px 0 8px}.offer-letter h4{font-size:12px;margin:15px 0 4px;text-transform:uppercase}.offer-letter ol,.offer-letter ul{padding-left:22px}.offer-letter li{margin:0 0 7px}.offer-letter table{width:100%;border-collapse:collapse;margin:8px 0 14px}.offer-letter td,.offer-letter th{border:1px solid #CBD5E1;padding:6px;text-align:left}.offer-letter .amount{text-align:right;white-space:nowrap}.offer-letter .signatures{display:grid;grid-template-columns:1fr 1fr;gap:32px;margin:28px 0}.offer-letter .sign-line{border-bottom:1px solid #172033;height:30px;margin-bottom:5px}.offer-letter .small{font-size:10px;color:#64748B}</style>
          <div style="text-align:right;font-weight:700;margin-bottom:14px">${dateIssued}</div>
          <div style="margin-bottom:14px"><strong>${esc(a.customer)}</strong><br>${borrowerAddress || ''}</div>
          <p>Dear ${a.type === 'BUSINESS' ? 'Sir/Madam' : 'Sir'},</p>
          <h3>LOAN FACILITY KSH ${Number(offerAmt).toLocaleString('en-KE')} (${numberWords(offerAmt).toUpperCase()} SHILLINGS ONLY)</h3>
          <p>Your application dated ${applicationDate} refers. It is our pleasure to confirm that we are prepared to grant you a loan of Kshs. ${Number(offerAmt).toLocaleString('en-KE')} for a maximum period of ${termWords.charAt(0).toUpperCase()}${termWords.slice(1)} (${offerTenor}) months, subject to the following terms and conditions.</p>
          <h4>Purpose</h4>
          <p>The facility has been granted for ${esc(purpose)}. The whole loan amount shall be used only for the purpose set out herein. Spectrum Credit Limited shall have the right to demand immediate payment of the outstanding loan amount together with interest if any part of the loan is used for another purpose.</p>
          <h4>Amount</h4><p>The maximum amount you can draw under this facility is Kshs. ${Number(offerAmt).toLocaleString('en-KE')}.</p>
          ${counterparty ? `<p><strong>${facilityType === 'BUY_OFF' ? 'Lender / buy-off company' : 'Seller'}:</strong> ${esc(counterparty)}${facilityDetail.address || facilityDetail.sellerAddress ? `<br>${esc(facilityDetail.address || facilityDetail.sellerAddress)}` : ''}${facilityDetail.town || facilityDetail.sellerTown ? `<br>${esc(facilityDetail.town || facilityDetail.sellerTown)}` : ''}</p>` : ''}
          <h4>Terms and Conditions</h4>
          <ol>
            <li><strong>Interest.</strong> Interest will be charged at ${Number(offerRate)}% per month on a flat-rate basis. Late payment will be charged at ${Number(a.penaltyRate) || 5}% per week on installment arrears. Spectrum Credit Limited reserves the right to amend interest charges in accordance with the facility agreement and applicable law.</li>
            <li><strong>Loan Application Fees.</strong> The loan processing fee is ${processingRate}% of the principal, exclusive of taxes. The fees shown in the attached schedule, together with other applicable third-party fees, shall be deducted from the loan amount on or before disbursement.</li>
            <li><strong>Security.</strong> The facility will be secured by a Security Agreement / Chattel Mortgage over motor vehicle registration number ${esc(registration)}, and joint registration between the Borrower or Guarantor and Spectrum Credit Limited over the vehicle.</li>
            <li><strong>Facility Sanction.</strong> Security must be perfected before drawdown. All costs of perfecting the security, including searches, valuation, advocate legal fees, NTSA transfer fees and in-charge fees, shall be borne by the Borrower. The facility may be linked to other charged collateral and Spectrum Credit Limited may consolidate securities held for the Borrower’s accounts, subject to applicable law and the security documents.</li>
            <li><strong>Buy-Off / Early Settlement.</strong> Early settlement or buy-off shall be effected upon written request to Spectrum Credit Limited. Where the loan has run for more than twelve (12) months, the payoff amount shall comprise the outstanding principal balance only, if any. Where it has run for less than twelve (12) months, the payoff amount shall comprise the outstanding principal balance plus fifty percent (50%) of the interest applicable to the remaining period up to twelve (12) months, subject to the facility agreement and applicable law.</li>
            <li><strong>Disbursement.</strong> Disbursement will be made upon completion of all legal formalities, including perfection and registration of securities. The loan will be disbursed directly to your account or nominated account by RTGS, net of applicable fees. Where the facility is for Buy-off or Asset Finance, payment may be made to the verified lender or seller in accordance with the approved transaction and undertaking.</li>
            <li><strong>Repayment.</strong> The facility shall be repaid in ${offerTenor} equal monthly installments of ${FinEngine.kes(installment)}. Repayment shall be made to SPECTRUM CREDIT LIMITED, Account No. 01148173434000, CO-OPERATIVE BANK, NAIROBI BUSINESS CENTRE, or through M-Pesa Paybill 311750 using the customer’s ID number as the account number. The first installment is due ${installmentDate}; subsequent installments shall fall due monthly until the facility is paid in full. Each installment is payable in cleared funds without deduction. Partial, late or failed payments may attract the stated penalty interest, without prejudice to other rights of Spectrum Credit Limited.</li>
            <li><strong>Other Terms and Conditions.</strong>
              <ol type="a">
                <li>“You” or “Your” means the Borrower and/or Guarantor(s), jointly or severally. This offer is open for unconditional acceptance for fourteen (14) days from the date of this letter, after which it shall be deemed withdrawn.</li>
                <li>The whole loan balance may become immediately due and payable, and Spectrum Credit Limited may enforce its rights over the collateral in accordance with applicable law and the security documents, upon default in payment, failure to perfect security, suspected fraud or material misrepresentation, execution or distress against the Borrower or Guarantor, or any other material event prejudicing repayment or security.</li>
                <li>Where the loan balance becomes due before the interest threshold under the early-settlement clause is met, any applicable difference may be included in the amount due, subject to the facility agreement and applicable law.</li>
                <li>Where you nominate a bank account that is not in your name, you confirm that the nomination is voluntary, that you are aware of its owner and beneficiaries, and that you authorize Spectrum Credit Limited to make payment to that account.</li>
                <li>The Borrower shall maintain and protect any tracking device installed on the vehicle at the Borrower’s cost until all amounts due are paid. The Borrower shall cooperate with Spectrum Credit Limited and the service provider to restore service if the tracker develops a fault. Costs arising from tracker tampering, damage, loss, recovery, enforcement or other breach may be debited to the loan account and recovered in accordance with the facility agreement.</li>
                <li>Reasonable costs and expenses incurred in enforcing this agreement, including tracking, towing, storage, auctioneer and legal costs, may be recoverable from the Borrower where permitted by the facility agreement and applicable law. Each provision is severable; if any provision is found invalid, the remaining provisions shall remain in force.</li>
                <li>The Borrower confirms that information provided is true, correct and complete, authorizes legally permitted Credit Reference Bureau enquiries and reporting, and consents to processing of personal data for this agreement in accordance with the Data Protection Act and Spectrum Credit Limited’s Data Privacy Statement.</li>
                <li>No variation of this letter is valid unless made in writing and signed by both parties. The Borrower and any Guarantor confirm that they have had the opportunity to obtain independent legal advice.</li>
              </ol>
            </li>
          </ol>
          <p>Yours faithfully,<br><strong>For: Spectrum Credit Limited</strong></p>
          <div class="signatures">
            <div><div class="sign-line"></div><strong>Loan Officer</strong><br>Date: ${dateIssued}</div>
            <div><div class="sign-line"></div><strong>Customer Signature</strong><br>${esc(a.customer)}<br>Date: __________________</div>
          </div>
          <h4>Acceptance of Offer</h4>
          <p>I, the undersigned, having read this offer letter, accept the offer on the terms and conditions stated above.</p>
          <div class="signatures"><div><div class="sign-line"></div>Borrower Signature &nbsp;&nbsp; Date: __________</div><div><div class="sign-line"></div>Witness Signature &nbsp;&nbsp; Date: __________</div></div>
          <h4>Fees Schedule</h4>
          <table><tbody>
            <tr><th>Borrower</th><td>${esc(a.customer)}</td></tr>
            <tr><th>Postal Address</th><td>${borrowerAddress || '—'}</td></tr>
            <tr><th>Telephone</th><td>${esc(a.phone || '—')}</td></tr>
            <tr><th>Email</th><td>${esc(a.email || '—')}</td></tr>
            <tr><th>Purpose of Facility</th><td>${esc(purpose)}</td></tr>
            <tr><th>Gross Amount (KES)</th><td class="amount">${FinEngine.kes(offerAmt)}</td></tr>
            ${feeRows}
            <tr><th>Total Fees</th><th class="amount">${FinEngine.kes(feeTotal)}</th></tr>
            <tr><th>Net Amount after Deductions</th><th class="amount">${FinEngine.kes(netAmount)}</th></tr>
          </tbody></table>
          <div class="small">Offer letter · ${esc(a.id)} · ${esc(facilityTypeLabel)} · No insurance or risk-fund fee is included in this offer.</div>
        </article>`;
    }

    // Keep the generated offer letter on the application so Branch Admin can
    // open it later from the Conditions Precedent panel.
    a.offerLetterHtml = content.innerHTML;
    a.offerLetter = {
      id: 'offer_letter',
      label: 'Generated Offer Letter',
      name: `offer-letter-${a.id}.html`,
      type: 'text/html',
      html: a.offerLetterHtml
    };
    DataStore.save(data);
    modal.classList.add('active');
  }
};

  if (typeof window !== 'undefined') {
  window.LOSModule = LOSModule;
}

