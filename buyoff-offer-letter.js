/* Buy-off, asset-finance, and straight-loan offer letters with insurance terms and itemized deductions. */
(() => {
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
  const currency = value => `KES ${Number(value || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const numberWords = value => {
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    const chunk = n => {
      if (n < 20) return ones[n];
      if (n < 100) return `${tens[Math.floor(n / 10)]}${n % 10 ? ` ${ones[n % 10]}` : ''}`;
      return `${ones[Math.floor(n / 100)]} Hundred${n % 100 ? ` ${chunk(n % 100)}` : ''}`;
    };
    let n = Math.max(0, Math.floor(Number(value) || 0));
    if (!n) return 'Zero';
    const parts = [];
    [[1000000000, 'Billion'], [1000000, 'Million'], [1000, 'Thousand'], [1, '']].forEach(([base, label]) => {
      if (n >= base) {
        const count = Math.floor(n / base);
        parts.push(`${chunk(count)}${label ? ` ${label}` : ''}`);
        n %= base;
      }
    });
    return parts.join(' ');
  };
  const dateText = value => {
    if (!value) return '—';
    const date = new Date(String(value).includes('T') ? value : `${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
  };
  const ordinalDateText = value => {
    if (!value) return '—';
    const date = new Date(String(value).includes('T') ? value : `${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return String(value).toUpperCase();
    const day = date.getDate();
    const suffix = day % 100 >= 11 && day % 100 <= 13 ? 'TH' : ({ 1: 'ST', 2: 'ND', 3: 'RD' }[day % 10] || 'TH');
    return `${day}${suffix} ${date.toLocaleDateString('en-GB', { month: 'long' }).toUpperCase()} ${date.getFullYear()}`;
  };
  const addMonthsToDate = (value, months) => {
    if (!value) return '';
    const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return '';
    const day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + months);
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, lastDay));
    return date.toISOString().slice(0, 10);
  };

  const applicationFor = args => {
    const data = DataStore.get();
    const id = args.find(value => typeof value === 'string' && (data.applications || []).some(app => app.id === value)) || data.selectedAppId;
    return (data.applications || []).find(app => app.id === id) || null;
  };

  const canGenerateOfferLetter = () => DataStore.get().activeRole === 'CREDIT_ADMIN';
  const requireCreditAdmin = () => {
    if (canGenerateOfferLetter()) return true;
    alert('Only the Credit Admin can generate offer letters.');
    return false;
  };

  const renderAssetFinanceOfferLetter = sourceApplication => {
    const data = DataStore.get();
    const application = (data.applications || []).find(item => item.id === sourceApplication.id) || sourceApplication;
    const detail = application.assetFinanceDetails || {};
    const isStraightLoan = application.loanType === 'STRAIGHT_LOAN';
    const principal = Number(application.approvedAmount || application.amount) || 0;
    const rate = Number(application.approvedRate ?? application.requestedRate ?? application.rate) || 0;
    const tenor = Number(application.approvedDuration || application.requestedDuration || application.tenor) || 1;
    const penaltyRate = Number(application.penaltyRate ?? 5);
    const rawRegs = detail.vehicleRegs || detail.registrations || detail.collateralVehicles
      || application.collateralVehicles || application.collateral?.registrations
      || application.collateral?.vehicleReg || application.collateral?.reg
      || detail.vehicleReg || application.reg || '—';
    const registrations = (Array.isArray(rawRegs) ? rawRegs : String(rawRegs).split(/[,;&]+/))
      .map(value => typeof value === 'object'
        ? (value.registration || value.vehicleReg || value.reg || value.regNumber || '')
        : value)
      .map(value => String(value || '').trim()).filter(Boolean);
    const vehicleRegs = [...new Set(registrations)].join(' & ') || '—';
    const insuranceExpiry = dateText(application.collateral?.insuranceExpiryDate || application.insuranceExpiryDate || '');
    const insuranceFund = principal * 0.025;
    const comprehensiveInsurance = Number(application.comprehensiveInsurance ?? detail.comprehensiveInsurance
      ?? detail.insurancePremium ?? application.insurancePremium ?? application.collateral?.insurancePremium
      ?? application.insuranceDebitNote?.amount ?? application.collateral?.insuranceDebitNote?.amount) || 0;
    const fees = [
      ['Loan Processing Fees (4%)', Number(application.processingFee) || principal * 0.04],
      ['Insurance / Risk Fund (2.5%)', Number(application.insuranceFund) || insuranceFund],
      ['Bank Transfer', Number(application.bankTransferFee) || 1000],
      ['Joint Registration', Number(application.jointRegistrationFee) || (isStraightLoan ? 4000 : 8000)],
      ['Legal Stamp Fee', Number(application.legalStampFee) || 500],
      ['CRB', Number(application.crbFee) || 1000],
      ['NTSA Search', Number(application.ntsaSearchFee) || (isStraightLoan ? 1000 : 2000)],
      ...(comprehensiveInsurance > 0 ? [['Comprehensive Insurance', comprehensiveInsurance]] : []),
      ...(!isStraightLoan ? [['Company Search', Number(application.companySearchFee) || 1000]] : [])
    ];
    const totalDeductions = fees.reduce((sum, [, amount]) => sum + amount, 0);
    const netAmount = principal - totalDeductions;
    const installment = Number(application.installment || application.monthlyInstallment)
      || Math.round((principal + principal * rate / 100 * tenor) / tenor + (Number(application.trackingFee) || 0));
    const hasClientContribution = [application.clientContribution, application.clientContributionRequired,
      application.clientContributionToSpectrum, application.customerContribution, detail.clientContribution,
      detail.clientContributionToSpectrum, detail.contribution].some(value => value != null && value !== '');
    const assetFinanceBalance = Number(application.assetFinanceBalance ?? application.assetBalance
      ?? application.balanceToSettle ?? application.outstandingBalance ?? detail.assetFinanceBalance
      ?? detail.assetBalance ?? detail.balance ?? detail.outstandingBalance
      ?? application.collateral?.assetFinanceBalance) || 0;
    const clientContribution = hasClientContribution
      ? Number(application.clientContribution ?? application.clientContributionRequired
        ?? application.clientContributionToSpectrum ?? application.customerContribution
        ?? detail.clientContribution ?? detail.clientContributionToSpectrum ?? detail.contribution) || 0
      : Math.max(0, assetFinanceBalance - netAmount);
    const repaymentRows = application.repaymentSchedule || application.installmentSchedule
      || application.monthlyInstallments || application.schedule;
    const disbursementDate = application.actualDisbursementDate || application.disbursedAt
      || application.disbursedDate || application.disbursementDate || application.facilityDisbursementDate
      || application.drawdownDate || application.disbursement?.disbursedAt || application.disbursement?.date || '';
    const firstDueDate = application.firstDueDate || application.firstInstallmentDate || '';
    const schedule = Array.isArray(repaymentRows) && repaymentRows.length
      ? repaymentRows.map((row, index) => ({
        month: Number(row?.month || row?.n) || index + 1,
        amount: Number(typeof row === 'number' ? row : row?.installment ?? row?.installmentAmount ?? row?.amount) || installment,
        dueDate: typeof row === 'object' ? row?.dueDate || row?.installmentDate || row?.date || '' : ''
      }))
      : Array.from({ length: tenor }, (_, index) => ({ month: index + 1, amount: installment, dueDate: '' }));
    schedule.forEach(row => {
      if (!row.dueDate) {
        const dueDateBase = firstDueDate || disbursementDate;
        row.dueDate = addMonthsToDate(dueDateBase, firstDueDate ? row.month - 1 : row.month);
      }
    });
    const customer = application.customer || detail.clientName || 'Borrower';
    const postal = application.address || application.postalAddress || '—';
    const town = application.town || '';
    const esc = escapeHtml;
    const applicationDate = dateText(application.applicationDate || application.createdAt || '');
    const letterDate = dateText(new Date().toISOString().slice(0, 10));
    const firstPageDate = ordinalDateText(application.applicationDate || application.createdAt || new Date().toISOString().slice(0, 10));
    const firstDue = dateText(firstDueDate || schedule[0]?.dueDate || '');
    const disbursementDateText = dateText(disbursementDate);
    const purpose = application.purpose || (isStraightLoan ? 'Straight loan' : 'Asset finance');
    const feesRows = fees.map(([label, amount]) => `<tr><td>${esc(label)}</td><td class="money">${currency(amount)}</td></tr>`).join('');
    const scheduleAmount = value => Number(value || 0).toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    const straightFeesRows = fees.map(([label, amount]) => {
      const thirdPartyStart = label === 'Legal Stamp Fee' ? '<tr class="category"><td>Third Party Fees</td><td></td></tr>' : '';
      const displayLabel = label === 'Insurance / Risk Fund (2.5%)' ? 'Risk Fund 2.5%' : label === 'Loan Processing Fees (4%)' ? 'Loan Processing Fees 4%' : label === 'Comprehensive Insurance' ? 'Comprehensive insurance' : label;
      return `${thirdPartyStart}<tr><td>${esc(displayLabel)}</td><td>${scheduleAmount(amount)}</td></tr>`;
    }).join('');
    const repaymentText = schedule.map(row =>
      `<li>Installment ${row.month} — due ${esc(row.dueDate ? dateText(row.dueDate) : 'to be confirmed upon disbursement')}: <strong>${currency(row.amount)}</strong></li>`
    ).join('');

    const offerTitle = isStraightLoan ? 'Straight Loan Offer Letter' : 'Asset Finance Offer Letter';
    const facilityLabel = isStraightLoan ? 'Straight Loan' : 'Asset Finance';
    const securityText = registrations.length
      ? `The facility is secured by a security agreement / chattel mortgage over collateral vehicle registration${registrations.length > 1 ? 's' : ''} <strong>${esc(vehicleRegs)}</strong> and joint registration between the borrower or guarantor and Spectrum Credit Limited, subject to the approved security documents.`
      : isStraightLoan
        ? 'Any security required for this facility, together with the applicable insurance cover, will be documented in the approved facility and security documents.'
        : `The facility is secured by a security agreement / chattel mortgage over motor vehicle registration${registrations.length > 1 ? 's' : ''} <strong>${esc(vehicleRegs)}</strong> and joint registration between the borrower or guarantor and Spectrum Credit Limited.`;
    const insuranceSubject = registrations.length
      ? `the collateral vehicle${registrations.length > 1 ? 's' : ''} <strong>${esc(vehicleRegs)}</strong>`
      : 'the collateral securing the facility as identified in the approved security documents';
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${offerTitle} - ${esc(application.id)}</title>
<style>
@page{size:A4;margin:18mm}*{box-sizing:border-box}body{font:12px Arial,sans-serif;color:#172033;line-height:1.5;margin:0}.letter{max-width:850px;margin:0 auto}.masthead{border-bottom:3px solid #0b5d8a;padding-bottom:12px;margin-bottom:20px}.brand{font-size:19px;font-weight:800;color:#0b5d8a}.meta{font-size:10px;color:#667085}.subject{font-weight:800;margin:16px 0 8px}.section{font-weight:800;text-transform:uppercase;color:#0b5d8a;margin:15px 0 5px;border-bottom:1px solid #d9e0e7;padding-bottom:3px}.terms{margin:5px 0;padding-left:22px}.terms li{padding:2px 0}.fees{width:100%;border-collapse:collapse;margin:8px 0}.fees th,.fees td{border:1px solid #cbd5e1;padding:6px;text-align:left}.fees th{background:#f1f5f9}.money{text-align:right!important;white-space:nowrap}.total{font-weight:800;background:#f1f5f9}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:42px}.sig{border-top:1px solid #172033;padding-top:6px;min-height:48px}.toolbar{display:flex;justify-content:flex-end;margin:0 auto 12px;max-width:850px}.toolbar button{padding:8px 12px;border:1px solid #cbd5e1;border-radius:5px;background:#f8fafc;color:#172033;cursor:pointer;font-weight:700}.small{font-size:10px;color:#667085}
 .straight-masthead{border:0;text-align:center;padding:0;margin:0 0 8px}.straight-logo{font-size:56px;line-height:.92;font-weight:900;font-style:italic;letter-spacing:-4px;color:#17258c}.straight-logo:before{content:"";display:block;width:58px;height:20px;margin:0 auto -2px;background:#f36b10;clip-path:polygon(0 100%,68% 0,100% 24%,28% 100%)}.straight-logo-sub{font-size:19px;line-height:1.1;font-weight:900;letter-spacing:4px;color:#e96819}.straight-tagline{font-size:16px;line-height:1.25;color:#172033}.straight-rule{height:7px;margin:10px calc((850px - 100vw)/2) 0;background:#13217f;border-top:3px solid #ed6b19}.straight-rule span{display:block}.straight-date{font-weight:800;text-transform:uppercase;margin:0 0 24px}.straight-address{font-weight:800;text-transform:uppercase;line-height:1.2;margin:0 0 18px}.straight-loan .subject{text-decoration:underline;text-transform:uppercase;margin:14px 0}.straight-loan .section{color:#111827;border:0;margin:12px 0 4px;padding:0}.straight-loan .terms{padding-left:28px}.straight-loan .terms>li{padding:4px 0 8px 8px}.straight-loan .terms>li>ol{padding-left:22px;margin:8px 0}.straight-loan .terms>li>ol>li{padding:4px 0} .straight-page-two-header,.straight-page-three-header,.straight-page-four-header,.straight-page-five-header,.straight-page-six-header{display:none}.straight-page-four,.straight-page-five,.straight-page-six{display:none}.straight-page-footer{display:none}.straight-page-six-title{text-align:center;font-weight:800;text-decoration:underline;text-transform:uppercase;margin:20px 0}.straight-page-six-contact,.straight-page-six-detail,.straight-page-six-fees{width:100%;border-collapse:collapse;margin:0 0 40px}.straight-page-six-contact td,.straight-page-six-detail td,.straight-page-six-fees td{border:1px solid #111;padding:5px 10px}.straight-page-six-contact td:first-child,.straight-page-six-detail td:first-child,.straight-page-six-fees td:first-child{width:50%}.straight-page-six-contact strong{text-transform:uppercase}.straight-page-six-subtitle{font-weight:800;text-decoration:underline;margin:0 0 8px}.straight-page-six-detail{margin-bottom:34px}.straight-page-six-detail td:last-child,.straight-page-six-fees td:last-child{text-align:center}.straight-page-six-fees .category td,.straight-page-six-fees .total td{font-weight:800}.straight-page-six-fees{margin-bottom:0}
@media print{body{font-size:10px;line-height:1.3}.straight-loan{font-size:11px;line-height:1.3}.toolbar{display:none}.letter{max-width:none}.masthead{margin-bottom:10px}.section{break-after:avoid}.terms li{padding:1px 0}.fees tr{break-inside:avoid;page-break-inside:avoid}.signatures{break-inside:avoid;page-break-inside:avoid}.straight-masthead{margin:0 0 8px}.straight-logo{font-size:54px}.straight-rule{margin-left:-18mm;margin-right:-18mm}.straight-date{margin-bottom:20px}.straight-address{margin-bottom:16px}.straight-page-two-header,.straight-page-three-header,.straight-page-four-header,.straight-page-five-header,.straight-page-six-header{display:block;text-align:center;margin:0 0 12px;break-inside:avoid;page-break-inside:avoid}.straight-page-two-header .straight-rule,.straight-page-three-header .straight-rule,.straight-page-four-header .straight-rule,.straight-page-five-header .straight-rule,.straight-page-six-header .straight-rule{margin-left:-18mm;margin-right:-18mm}.straight-loan .terms>li:nth-child(6),.straight-loan .straight-fees-start,.straight-loan .straight-page-three-start{break-before:page;page-break-before:always}.straight-page-four,.straight-page-five,.straight-page-six{display:block;break-before:page;page-break-before:always}.straight-page-four-terms{list-style:none;margin:10px 0 0;padding:0}.straight-page-four-terms li{position:relative;padding:4px 0 8px 28px}.straight-page-four-terms li strong{position:absolute;left:0}.straight-page-four-close{margin-top:20px}.straight-page-four-signers{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:64px}.straight-page-four-signers p{margin:0}.straight-acceptance-title{text-align:center;font-weight:800;text-decoration:underline;margin:20px 0 48px}.straight-acceptance-copy{margin:0 0 90px}.straight-acceptance-line{display:inline-block;vertical-align:baseline;border-bottom:1px solid #111;min-width:45%;height:1em}.straight-acceptance-row{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-bottom:125px}.straight-acceptance-row span{white-space:nowrap}.straight-witness-title{text-align:center;font-weight:800;text-decoration:underline;margin:0 0 64px}.straight-witness-copy{margin:0 0 88px}.straight-witness-row{display:grid;grid-template-columns:1fr 1fr;gap:40px}.straight-witness-row span{white-space:nowrap}.straight-page-footer{display:flex;position:fixed;top:auto;bottom:5mm;left:0;right:0;justify-content:space-between;gap:30px;font-size:10px;color:#111}.straight-page-footer span{width:45%;border-bottom:1px solid #111;padding-bottom:3px}}
</style></head><body class="${isStraightLoan ? 'straight-loan' : ''}"><div class="toolbar"><button onclick="window.print()">Print offer letter</button></div>
<main class="letter"><header class="masthead${isStraightLoan ? ' straight-masthead' : ''}">${isStraightLoan
  ? `<div class="straight-logo">Spectrum</div><div class="straight-logo-sub">CREDIT LIMITED</div><div class="straight-tagline">We Don’t Just Lend. We Empower.</div><div class="straight-rule"><span></span></div>`
  : `<div class="brand">SPECTRUM CREDIT LIMITED</div><div class="meta">${facilityLabel} · Offer reference: ${esc(application.id)}<br>Letter date: ${esc(letterDate)}</div>`}</header>
${isStraightLoan ? `<p class="straight-date">${esc(firstPageDate)}</p>` : ''}<p class="${isStraightLoan ? 'straight-address' : ''}">${esc(customer)}<br>${esc(postal)}${town ? `<br>${esc(town)}` : ''}</p><p>Dear ${isStraightLoan ? 'Sir' : esc(customer)},</p>
<div class="subject">LOAN FACILITY ${isStraightLoan ? `Kshs.${principal.toLocaleString('en-KE', { maximumFractionDigits: 0 })}` : currency(principal)} (${esc(numberWords(principal).toUpperCase())} SHILLINGS ONLY)</div>
<p>Your application${applicationDate !== '—' ? ` dated ${esc(applicationDate)}` : ''} refers. We are pleased to confirm that Spectrum Credit Limited is prepared to grant you a loan facility of <strong>${isStraightLoan ? `Kshs.${principal.toLocaleString('en-KE', { maximumFractionDigits: 0 })}` : currency(principal)}</strong> for a maximum period of <strong>${tenor} months</strong>, subject to the following terms and conditions.</p>
<div class="section">Purpose</div><p>The facility is granted for <strong>${esc(purpose)}</strong>. The loan proceeds shall be used only for this purpose. Spectrum Credit Limited may demand repayment of the outstanding balance together with interest if any part of the facility is used for another purpose.</p>
<div class="section">Amount</div><p>The maximum amount available under this facility is <strong>${isStraightLoan ? `Kshs.${principal.toLocaleString('en-KE', { maximumFractionDigits: 0 })}` : currency(principal)}</strong>.</p>
<div class="section">Terms and conditions</div><ol class="terms">
<li><strong>Interest:</strong> Interest is charged at <strong>${rate}% per month flat</strong> for the approved tenor. Late payment attracts a charge of <strong>${penaltyRate}% per week</strong> on installment arrears, subject to the facility documents and applicable law.</li>
<li><strong>Loan application fees:</strong> Processing fees of 4% of principal, exclusive of taxes and third-party fees, will be deducted from the proceeds on or before disbursement.</li>
<li><strong>Security:</strong> ${securityText}</li>
<li><strong>Insurance:</strong><ol type="a"><li>Comprehensive insurance cover must be maintained on ${insuranceSubject}, with Spectrum Credit Limited's interest noted with the insurer before disbursement${insuranceExpiry !== '—' ? ` (recorded expiry: ${esc(insuranceExpiry)})` : ''}.</li><li>On expiry of an existing policy, Spectrum Credit Limited may arrange or renew insurance at the borrower's cost and for the borrower's account.</li><li>An insurance / risk fund of <strong>2.5% of the principal</strong> is charged and deducted from the proceeds. The estimated deduction is <strong>${currency(Number(application.insuranceFund) || insuranceFund)}</strong>. Comprehensive insurance is separately itemized in the fees schedule when an amount is available.</li></ol></li>
<li><strong>Facility sanction:</strong> Any security must be perfected before drawdown. Searches, valuation, advocate fees, NTSA transfer and registration fees where applicable, in-charge fees and other perfection costs are payable by the borrower.</li>
<li><div class="straight-page-two-header"><div class="straight-logo">Spectrum</div><div class="straight-logo-sub">CREDIT LIMITED</div><div class="straight-tagline">We Don’t Just Lend. We Empower.</div><div class="straight-rule"><span></span></div></div><strong>Buy-off / early settlement:</strong> Any early settlement must be requested in writing. Where the loan has run for more than twelve (12) months, payoff comprises the outstanding principal balance, if any. Where it has run for less than twelve (12) months, payoff comprises the outstanding principal plus 50% of the interest applicable to the remaining period up to twelve (12) months, subject to the facility documents and applicable law.</li>
<li><strong>Disbursement:</strong> Disbursement will be made after completion of legal formalities and perfection and registration of securities. Funds will be sent by RTGS, net of applicable deductions, to the borrower's nominated account${isStraightLoan ? '.' : ' or as directed by the approved asset-finance transaction instructions.'}${disbursementDateText !== '—' ? ` Facility disbursement date: <strong>${esc(disbursementDateText)}</strong>.` : ''}</li>
<li><strong>Repayment:</strong> Repayments are due in <strong>${tenor} monthly installments</strong> as set out below${firstDue !== '—' ? `, commencing on <strong>${esc(firstDue)}</strong>` : `, commencing 30 days after the facility is disbursed`}. Subsequent due dates are mapped monthly from the disbursement / first-installment date, using the recorded installment schedule where available. Pay in cleared funds to Spectrum Credit Limited, Cooperative Bank, account 01148173434000, Nairobi Business Centre, or via M-Pesa Paybill 311750 using the customer's ID number as the account number. Installments must be paid in full on or before each due date.<ul>${repaymentText}</ul>${!disbursementDate && !firstDueDate ? 'Exact calendar due dates will be confirmed once the facility disbursement date is recorded.' : ''} Any partial, late or failed payment attracts the applicable late-payment charge, without prejudice to other rights.</li>
<li class="straight-terms-continuation"><strong>OTHER TERMS AND CONDITIONS:</strong><ol type="a"><li>“You” or “your” means the borrower and any guarantor jointly or severally. This offer is open for unconditional acceptance for fourteen (14) days from its date and may be withdrawn if not accepted within that period.</li><li>If an installment or other secured amount is unpaid; security is not perfected; required insurance is not maintained or Spectrum Credit's interest is not noted; or fraud, forgery, tracker tampering, third-party ownership claims, material non-disclosure, threatened execution or material deterioration in financial standing occurs, the whole balance may become due and Spectrum Credit may exercise its rights over the security, subject to applicable law and required notices.</li><li>Where the borrower defaults, Spectrum Credit may take recovery steps in accordance with the facility and applicable law. The borrower bears reasonable recovery and disposal costs.</li><li>Any existing security remains subject to its governing documents and applicable law.</li><li class="straight-page-three-start"><div class="straight-page-three-header"><div class="straight-logo">Spectrum</div><div class="straight-logo-sub">CREDIT LIMITED</div><div class="straight-tagline">We Don’t Just Lend. We Empower.</div><div class="straight-rule"><span></span></div></div>If the disbursement account is not the borrower's personal account, the borrower confirms it was voluntarily nominated, authorizes payment to it and will indemnify Spectrum Credit against related claims.</li><li>Bounced cheques attract KES 5,000 per cheque and cheque stoppage attracts KES 2,500, subject to applicable law.</li>${registrations.length ? '<li>A tracking device must be installed and maintained on the secured vehicle at the borrower’s cost until all liabilities are discharged. The borrower is responsible for tampering, damage or loss, must cooperate with fault resolution, and must avail the vehicle for tracker removal within seven (7) days after cancellation or settlement. Logbook discharge will not be completed until tracker removal.</li>' : ''}<li>Claims, fees and expenses arising from breach or enforcement—including insurance renewals, tracking, auctioneer, towing, yard storage, legal fees and disbursements—may be debited to the loan account and recovered by lawful means.</li><li>Where the facility is cancelled in writing before disbursement, the borrower remains liable for origination costs already incurred. A facility cannot be cancelled after partial disbursement.</li><li>The borrower bears collateral discharge costs. If a guarantor pays any amount under the facility, the borrower will indemnify the guarantor, who may exercise applicable subrogation rights.</li><li>Tax or withholding will be applied only to the extent required by law.</li><li>Each provision is severable. The borrower and any guarantor confirm information supplied is true, correct and complete; will not use facility proceeds in breach of anti-money-laundering laws; and consent to lawful credit-reference bureau and personal-data processing in accordance with applicable law and Spectrum Credit's privacy statement.</li><li>Where applicable, a guarantor guarantees the borrower's obligations and consents to any security required under the facility documents${registrations.length ? ' including use and joint registration of the vehicle as security' : ''}. No variation is valid unless made in writing and signed by the parties.</li></ol></li>
</ol>
${isStraightLoan ? `<section class="straight-page-four"><div class="straight-page-four-header"><div class="straight-logo">Spectrum</div><div class="straight-logo-sub">CREDIT LIMITED</div><div class="straight-tagline">We Don’t Just Lend. We Empower.</div><div class="straight-rule"><span></span></div></div><ol class="straight-page-four-terms"><li><strong>vii.</strong>You declare that all information and warranties provided by you as the basis for this facility are true, correct and complete.</li><li><strong>ix.</strong>You warrant that no part of funds used to acquire the security, loan proceeds or loan repayments will contravene the Proceeds of Crime and Anti-Money Laundering Act or any other law in Kenya, and you will indemnify Spectrum Credit against any claim arising from a breach.</li><li><strong>x.</strong>You authorize Spectrum Credit to obtain, procure, disclose, respond to, advise, exchange and communicate your personal data and loan account information with Credit Reference Bureaus, a regulatory body or Metropol Data Services Ltd, as required by law.</li><li><strong>xi.</strong>You consent to the information provided, together with your personal data and/or acquired personal data, being used for the purposes of this agreement and in accordance with the Data Protection Act.</li><li><strong>xii.</strong>You warrant that you and any guarantor have had the opportunity to obtain independent legal counsel and have either obtained that advice or voluntarily chosen not to do so.</li><li><strong>xiii.</strong>Where applicable, the Guarantor consents to use of the vehicle as security and joint registration of the vehicle, and guarantees payment and discharge of the Borrower’s obligations and liabilities to Spectrum Credit under the loan facility.</li><li><strong>xiv.</strong>No variation of this letter is valid unless made in writing and signed by both parties.</li><li><strong>xv.</strong>By executing this letter, you acknowledge and consent to information provided pursuant to this facility being handled and processed in accordance with Spectrum Credit’s Data Privacy Statement, available at <a href="https://www.spectrumcredit.co.ke" target="_blank" rel="noopener">www.spectrumcredit.co.ke</a>, as updated from time to time.</li></ol><p class="straight-page-four-close">Yours faithfully,<br>For: Spectrum Credit Limited</p><div class="straight-page-four-signers"><p><strong><u>Duncan</u></strong><br>Business Development</p><p><strong><u>Justine Munene</u></strong><br>Business Development Manager</p></div></section>` : ''}
${isStraightLoan ? `<section class="straight-page-five"><div class="straight-page-five-header"><div class="straight-logo">Spectrum</div><div class="straight-logo-sub">CREDIT LIMITED</div><div class="straight-tagline">We Don’t Just Lend. We Empower.</div><div class="straight-rule"><span></span></div></div><h2 class="straight-acceptance-title">ACCEPTANCE OF OFFER</h2><p class="straight-acceptance-copy">I <span class="straight-acceptance-line"></span> referred to in letter of which the foregoing is a copy, accept the offer hereby on terms and conditions.</p><div class="straight-acceptance-row"><span>Signature<span class="straight-acceptance-line"></span></span><span>Date<span class="straight-acceptance-line"></span></span></div><h3 class="straight-witness-title">Witness</h3><p class="straight-witness-copy">I <span class="straight-acceptance-line"></span> confirm that I saw the above-named sign this letter of offer.</p><div class="straight-witness-row"><span>Signature<span class="straight-acceptance-line"></span></span><span>Date<span class="straight-acceptance-line"></span></span></div></section>` : ''}
${isStraightLoan ? `<section class="straight-page-six"><div class="straight-page-six-header"><div class="straight-logo">Spectrum</div><div class="straight-logo-sub">CREDIT LIMITED</div><div class="straight-tagline">We Don’t Just Lend. We Empower.</div><div class="straight-rule"><span></span></div></div><h2 class="straight-page-six-title">Fees Schedule</h2><table class="straight-page-six-contact"><tbody><tr><td>Borrower</td><td><strong>${esc(customer)}</strong></td></tr><tr><td>Postal Address</td><td><strong>${esc(postal)}${town ? `, ${esc(town)}` : ''}</strong></td></tr><tr><td>Telephone Numbers</td><td><strong>${esc(application.phone || application.mobile || '—')}</strong></td></tr><tr><td>Email</td><td>${esc(application.email || '')}</td></tr></tbody></table><h3 class="straight-page-six-subtitle">Detail of the Facility</h3><table class="straight-page-six-detail"><tbody><tr><td>Purpose of the Facility</td><td>Amount KES</td></tr><tr><td>${esc(purpose)}</td><td>${scheduleAmount(principal)}</td></tr></tbody></table><table class="straight-page-six-fees"><tbody><tr class="total"><td>Gross Amount</td><td>${scheduleAmount(principal)}</td></tr>${straightFeesRows}<tr class="total"><td>Net Amount after Deductions</td><td>${currency(netAmount).replace('KES ', '')}</td></tr>${assetFinanceBalance > 0 ? `<tr class="total"><td>Asset finance balance</td><td>${currency(assetFinanceBalance).replace('KES ', '')}</td></tr>` : ''}${assetFinanceBalance > 0 || hasClientContribution ? `<tr class="total"><td>Clients’ contribution to Spectrum</td><td>${currency(clientContribution).replace('KES ', '')}</td></tr>` : ''}</tbody></table></section>` : `<div class="section">${facilityLabel} fees schedule</div><table class="fees"><thead><tr><th>Facility / deduction</th><th class="money">Amount (KES)</th></tr></thead><tbody>
<tr><td>Borrower</td><td>${esc(customer)}</td></tr><tr><td>Postal address</td><td>${esc(postal)}${town ? `, ${esc(town)}` : ''}</td></tr><tr><td>Telephone number</td><td>${esc(application.phone || application.mobile || '—')}</td></tr><tr><td>Email</td><td>${esc(application.email || '—')}</td></tr><tr><td>Purpose of facility</td><td>${esc(purpose)}</td></tr><tr><td>Amount (KES)</td><td class="money">${currency(principal)}</td></tr><tr><td>Gross facility amount</td><td class="money">${currency(principal)}</td>${feesRows}<tr class="total"><td>Total deductions</td><td class="money">${currency(totalDeductions)}</td></tr><tr class="total"><td>Net amount after deductions</td><td class="money">${currency(netAmount)}</td></tr>
</tbody></table><p class="small">Fees shown are estimates based on stated charges. Taxes and verified third-party costs may vary. Comprehensive insurance is included only where its premium has been provided; confirm the insurer's final debit note before disbursement.</p>`}
${isStraightLoan ? '' : `<p>Yours faithfully,<br><strong>For: Spectrum Credit Limited</strong></p>
<div class="signatures"><div class="sig">Loan Officer<br>Name: __________________________<br>Date: __________________________</div><div class="sig">Authorized signatory<br>Name: __________________________<br>Date: __________________________</div></div>
<div class="section">Acceptance of offer</div><p>I, the undersigned, have read and understood this offer and accept it unconditionally on the terms and conditions set out above.</p>
<div class="signatures"><div class="sig">Customer signature<br>Name: ${esc(customer)}<br>ID No: ${esc(application.idNumber || detail.clientIdNumber || '—')}<br>Date: __________________________</div><div class="sig">Witness signature<br>Name: __________________________<br>Signature: _____________________<br>Date: __________________________</div></div>
<p class="small">This offer is subject to final approval, verification of transaction details and completion of all legal, security and insurance formalities.</p>`}
${isStraightLoan ? '<div class="straight-page-footer"><span>Loan Officer</span><span>Customer Signature</span></div>' : ''}</main></body></html>`;

    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const modal = document.getElementById('offer-letter-modal');
    const content = document.getElementById('offer-letter-content');
    const title = modal?.querySelector('.modal-title');
    if (!modal || !content) {
      window.open(url, '_blank', 'noopener');
      return;
    }
    if (title) title.textContent = offerTitle;
    const filePrefix = isStraightLoan ? 'straight-loan' : 'asset-finance';
    content.innerHTML = `<div style="padding:12px"><div style="display:flex;justify-content:flex-end;margin-bottom:10px"><a class="btn btn-primary" href="${url}" download="${filePrefix}-offer-${escapeHtml(application.id)}.html"><i class="ti ti-download"></i> Download Offer Letter</a></div><iframe title="${facilityLabel} offer letter" src="${url}" style="display:block;width:100%;height:75vh;min-height:560px;border:1px solid #D0D5DD;border-radius:8px;background:#FFF"></iframe></div>`;
    modal.classList.add('active');
    application.offerLetterGeneratedAt = new Date().toISOString();
    application.audit = Array.isArray(application.audit) ? application.audit : [];
    application.audit.unshift({ action: `${facilityLabel} offer letter generated with insurance terms`, by: data.roles?.[data.activeRole]?.title || data.activeRole, at: new Date().toISOString().slice(0, 16).replace('T', ' ') });
    DataStore.save(data);
  };

  const renderOfferLetter = sourceApplication => {
    const data = DataStore.get();
    const application = (data.applications || []).find(item => item.id === sourceApplication.id) || sourceApplication;
    const detail = application.buyoffDetails || {};
    const principal = Number(application.approvedAmount || application.amount) || 0;
    const rate = Number(application.approvedRate ?? application.requestedRate ?? application.rate) || 0;
    const tenor = Number(application.approvedDuration || application.requestedDuration || application.tenor) || 1;
    const tracking = Number(application.trackingFee) || 0;
    const vehicleReg = detail.vehicleReg || application.reg || '—';
    const interest = principal * rate / 100 * tenor;
    const installment = Number(application.installment || application.monthlyInstallment)
      || Math.round((principal + interest) / tenor + tracking);
    const processingFee = principal * 0.04;
    const insuranceFund = principal * 0.025;
    const feeItems = [
      ['Loan Processing Fees (4%)', processingFee],
      ['Insurance / Risk Fund (2.5%)', insuranceFund],
      ['Bank Transfer', 1000],
      ['Joint Registration', 6000],
      ['Legal Stamp Fee', 500],
      ['CRB', 1000],
      ['NTSA Search', 1000]
    ];
    const totalDeductions = feeItems.reduce((sum, [, amount]) => sum + amount, 0);
    const netAmount = principal - totalDeductions;
    const buyoffBalance = Number(detail.buyoffAmt || detail.balance) || 0;
    const clientContribution = Math.max(0, buyoffBalance - netAmount);
    const customer = application.customer || detail.clientNames || 'Borrower';
    const postal = application.address || application.postalAddress || '—';
    const town = application.town || '';
    const letterDate = dateText(new Date().toISOString().slice(0, 10));
    const applicationDate = dateText(application.createdAt || application.applicationDate || '');
    const purpose = application.purpose || 'Buy-off';
    const firstDue = dateText(application.firstDueDate || application.firstInstallmentDate || '');
    const insuranceExpiry = dateText(application.collateral?.insuranceExpiryDate || application.insuranceExpiryDate || '');
    const esc = escapeHtml;
    const feesRows = feeItems.map(([label, amount]) => `<tr><td>${esc(label)}</td><td class="money">${currency(amount)}</td></tr>`).join('');

    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Buy-off Offer Letter - ${esc(application.id)}</title>
<style>
@page{size:A4;margin:18mm}*{box-sizing:border-box}body{font:12px Arial,sans-serif;color:#172033;line-height:1.5;margin:0}.letter{max-width:850px;margin:0 auto}.masthead{border-bottom:3px solid #0b5d8a;padding-bottom:12px;margin-bottom:20px}.brand{font-size:19px;font-weight:800;color:#0b5d8a}.meta{font-size:10px;color:#667085}.title{text-align:center;font-size:17px;font-weight:800;margin:16px 0;text-decoration:underline}.subject{font-weight:800;margin:16px 0 8px}.section{font-weight:800;text-transform:uppercase;color:#0b5d8a;margin:15px 0 5px;border-bottom:1px solid #d9e0e7;padding-bottom:3px}.terms{margin:5px 0;padding-left:22px}.terms li{padding:2px 0}.fees{width:100%;border-collapse:collapse;margin:8px 0}.fees th,.fees td{border:1px solid #cbd5e1;padding:6px;text-align:left}.fees th{background:#f1f5f9}.money{text-align:right!important;white-space:nowrap}.total{font-weight:800;background:#f1f5f9}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:46px}.sig{border-top:1px solid #172033;padding-top:6px;min-height:48px}.toolbar{display:flex;justify-content:flex-end;gap:8px;margin:0 auto 12px;max-width:850px}.toolbar a,.toolbar button{padding:8px 12px;border:1px solid #cbd5e1;border-radius:5px;background:#f8fafc;color:#172033;text-decoration:none;cursor:pointer;font-weight:700}.toolbar .primary{background:#0b5d8a;color:white;border-color:#0b5d8a}.small{font-size:10px;color:#667085}.page-break{break-before:page}.buyoff-letter{color:#111;line-height:1.35}.buyoff-masthead{border:0;text-align:center;padding:0;margin:0 0 8px}.buyoff-logo{font-size:56px;line-height:.92;font-weight:900;font-style:italic;letter-spacing:-4px;color:#17258c}.buyoff-logo:before{content:"";display:block;width:58px;height:20px;margin:0 auto -2px;background:#f36b10;clip-path:polygon(0 100%,68% 0,100% 24%,28% 100%)}.buyoff-logo-sub{font-size:19px;line-height:1.1;font-weight:900;letter-spacing:4px;color:#e96819}.buyoff-tagline{font-size:16px;line-height:1.25;color:#172033}.buyoff-rule{height:7px;margin:10px calc((850px - 100vw)/2) 0;background:#13217f;border-top:3px solid #ed6b19}.buyoff-date{font-weight:800;text-transform:uppercase;margin:0 0 24px}.buyoff-address{font-weight:800;text-transform:uppercase;line-height:1.2;margin:0 0 18px}.buyoff-letter .subject{text-decoration:underline;text-transform:uppercase;color:#111;margin:14px 0}.buyoff-letter .section{color:#111;border:0;margin:15px 0 5px;padding:0}.buyoff-letter .terms{padding-left:22px}.buyoff-letter .terms>li{padding:4px 0 8px 8px}.buyoff-letter .terms>li>ol{padding-left:22px;margin:8px 0}.buyoff-letter .terms>li>ol>li{padding:4px 0}.buyoff-letter .terms>li.page-break::marker{content:""}.buyoff-page-two-header,.buyoff-page-three-header{display:none}.buyoff-page-footer{display:none}
@media print{body{font-size:11px}.toolbar{display:none}.letter{max-width:none}.masthead{margin-bottom:14px}.section{break-after:avoid}.fees tr{break-inside:avoid}.signatures{break-inside:avoid}.buyoff-letter{font-size:11px;line-height:1.3}.buyoff-masthead{margin:0 0 8px}.buyoff-logo{font-size:54px}.buyoff-rule{margin-left:-18mm;margin-right:-18mm}.buyoff-date{margin-bottom:20px}.buyoff-address{margin-bottom:16px}.buyoff-page-two-header,.buyoff-page-three-header{display:block;text-align:center;margin:0 0 12px;break-inside:avoid;page-break-inside:avoid}.buyoff-page-two-header .buyoff-rule,.buyoff-page-three-header .buyoff-rule{margin-left:-18mm;margin-right:-18mm}.buyoff-letter .terms>li.page-break,.buyoff-letter .terms li.buyoff-page-three-start,.buyoff-fees-start{break-before:page;page-break-before:always}.buyoff-page-footer{display:flex;position:fixed;bottom:5mm;left:0;right:0;justify-content:space-between;gap:30px;font-size:10px;color:#111}.buyoff-page-footer span{width:45%;border-bottom:1px solid #111;padding-bottom:3px}}
</style></head><body class="buyoff-letter"><div class="toolbar"><button onclick="window.print()">Print offer letter</button></div>
<main class="letter"><header class="masthead buyoff-masthead"><div class="buyoff-logo">Spectrum</div><div class="buyoff-logo-sub">CREDIT LIMITED</div><div class="buyoff-tagline">We Don’t Just Lend. We Empower.</div><div class="buyoff-rule"><span></span></div></header>
<p class="buyoff-date">${esc(ordinalDateText(application.createdAt || application.applicationDate || new Date().toISOString().slice(0, 10)))}</p><p class="buyoff-address">${esc(customer)}<br>${esc(postal)}${town ? `<br>${esc(town)}` : ''}</p><p>Dear Sir,</p>
<div class="subject">LOAN FACILITY Kshs.${principal.toLocaleString('en-KE', { maximumFractionDigits: 0 })} (${esc(numberWords(principal).toUpperCase())} SHILLINGS ONLY)</div>
<p>Your application${applicationDate !== '—' ? ` dated ${esc(applicationDate)}` : ''} refers. We are pleased to confirm that we are prepared to grant you a loan facility of <strong>Kshs.${principal.toLocaleString('en-KE', { maximumFractionDigits: 0 })}</strong> for a maximum period of <strong>${numberWords(tenor)} (${tenor}) months</strong>, subject to the following terms and conditions.</p>
<div class="section">Purpose</div><p>The facility has been granted for <strong>${esc(purpose)}</strong>. The whole loan amount shall be used only for the purpose set out herein. Spectrum Credit Limited may demand immediate repayment of the outstanding loan amount together with interest if any part of the facility is used for another purpose.</p>
<div class="section">Amount</div><p>The maximum amount available under this facility is <strong>Kshs.${principal.toLocaleString('en-KE', { maximumFractionDigits: 0 })}</strong>.</p>
<div class="section">Terms and conditions</div><ol class="terms">
<li><strong>Interest:</strong> Interest is charged at <strong>${rate}% per month flat</strong> for the approved tenor. Late payment attracts a charge of <strong>${Number(application.penaltyRate ?? 5)}% per week</strong> on installment arrears after any applicable grace period. Any change to pricing will be communicated in accordance with applicable law and the facility documents.</li>
<li><strong>Loan application fees:</strong> Processing fees of 4% of principal, exclusive of taxes and third-party fees, will be deducted from the loan proceeds on or before disbursement.</li>
<li><strong>Security</strong><p>The facility will be secured by:</p><ol type="a"><li>Security agreement / chattel mortgage over motor vehicle registration number <strong>${esc(vehicleReg)}</strong>.</li><li>Joint registration between the borrower or guarantor and Spectrum Credit Limited over motor vehicle <strong>${esc(vehicleReg)}</strong>.</li></ol></li>
<li><strong>Insurance</strong><ol type="a"><li>Comprehensive insurance cover must be maintained for motor vehicle <strong>${esc(vehicleReg)}</strong> used as collateral, with Spectrum Credit Limited's interest noted with the insurer before disbursement${insuranceExpiry !== '—' ? ` (recorded expiry: ${esc(insuranceExpiry)})` : ''}.</li><li>Spectrum Credit Limited reserves the right to arrange or renew insurance cover upon expiry of an existing policy, at the borrower's cost and for the borrower's account.</li><li>An insurance / risk fund of <strong>2.5% of the principal borrowed</strong> is charged and deducted from the loan proceeds. The estimated deduction on this offer is <strong>${currency(insuranceFund)}</strong>.</li></ol></li>
<li><strong>Facility sanction</strong><ul><li>Security must be perfected before drawdown. All costs of perfecting the security, including searches, valuation, advocate legal fees, NTSA transfer fees, in-charge fees and other applicable costs, are payable by the borrower.</li></ul></li>
<li class="page-break"><div class="buyoff-page-two-header"><div class="buyoff-logo">Spectrum</div><div class="buyoff-logo-sub">CREDIT LIMITED</div><div class="buyoff-tagline">We Don’t Just Lend. We Empower.</div><div class="buyoff-rule"><span></span></div></div><strong>6. Buy-off / Early Settlement</strong><p>Early settlement or buy-off shall be effected upon written request to Spectrum Credit and shall be calculated as follows:</p><ol type="a"><li>Where the loan has run for more than twelve (12) months, the payoff amount shall comprise the outstanding principal balance only, if any.</li><li>Where the loan has run for less than twelve (12) months, the payoff amount shall comprise the outstanding principal balance plus fifty percent (50%) of the interest applicable to the remaining period up to twelve (12) months.</li></ol></li>
<li><strong>Disbursement</strong><p>The loan will be disbursed upon completion of all legal formalities, including perfection and registration of securities. Funds will be sent by RTGS, net of applicable fees, to the borrower's nominated account. For the buy-off, settlement will be processed in line with approved buy-off instructions and the verified balance.</p></li>
<li><strong>Repayment</strong><ol type="a"><li>The facility shall be repaid in <strong>${numberWords(tenor)} (${tenor}) equal monthly installments of ${currency(installment)}</strong>, commencing from the first month of drawdown / disbursement and continuing until paid in full. Payment shall be made in cleared funds to <strong>Spectrum Credit Limited</strong>, Cooperative Bank, account <strong>01148173434000</strong>, Nairobi Business Centre, or through M-Pesa Paybill <strong>311750</strong>, using the customer's ID number as the account number.</li><li>Unless otherwise stated in writing, the first installment shall fall due thirty (30) days from the drawdown / disbursement date${firstDue !== '—' ? ` (scheduled first due date: <strong>${esc(firstDue)}</strong>)` : ''}. Subsequent installments shall fall due monthly on the corresponding date until the loan is paid in full.</li><li>Each installment is due and payable in cleared funds, without deduction, on its due date.</li><li>The full installment must be deposited to the account above on or before its due date. Any partial, late or failed installment may attract applicable late-payment charges or penalty interest, without prejudice to Spectrum Credit Limited's other rights.</li></ol></li>
<li><strong>OTHER TERMS AND CONDITIONS</strong><ol type="a"><li>“You” or “your” means the borrower and any guarantor jointly or severally.</li><li>This offer is open for unconditional acceptance for fourteen (14) days from its date. If it is not accepted within that period, it may be treated as withdrawn.</li><li>The whole loan balance may become due and payable, and Spectrum Credit may exercise its rights over the security subject to applicable law and required notices, if any of the following occurs:<ol type="i"><li>Default in payment of any installment, interest, penalty or other amount secured under the facility.</li><li>Failure to fully perfect the security, including completion of transfer or joint registration, noting Spectrum Credit's interest as loss payee under the insurance policy, maintaining required insurance, or releasing original title documents to Spectrum Credit where applicable.</li><li>Reasonable grounds to believe criminal activity, fraud, forgery, tracker tampering or a third-party ownership claim over the security has occurred.</li><li>Distress or execution is levied or threatened against the borrower’s or guarantor’s property.</li><li>Material non-disclosure is discovered or alleged which affects Spectrum Credit's rights.</li><li>An act or omission prejudices Spectrum Credit's rights, or there is reason to believe the borrower's or guarantor's financial position has materially deteriorated.</li></ol></li><li>Where the loan balance becomes due before interest paid meets the applicable early-settlement amount, Spectrum Credit may include the difference in the loan balance, subject to the facility documents and applicable law.</li><li class="buyoff-page-three-start"><div class="buyoff-page-three-header"><div class="buyoff-logo">Spectrum</div><div class="buyoff-logo-sub">CREDIT LIMITED</div><div class="buyoff-tagline">We Don’t Just Lend. We Empower.</div><div class="buyoff-rule"><span></span></div></div>If the disbursement account is not the borrower's personal account, the borrower confirms it was voluntarily nominated, authorizes payment to it, and accepts responsibility for claims relating to the nominated account. The borrower acknowledges that this account is not the borrower's personal account and indemnifies Spectrum Credit against related claims.</li><li>All loan facilities may be linked to pre-existing charged collateral until all facilities are paid. Spectrum Credit may combine accounts and consolidate securities in accordance with the facility and security documents and applicable law.</li><li><strong>5% weekly charge and returned payments:</strong> If the borrower fails to make a required repayment, an additional charge of <strong>5% per week</strong> may be applied to installment arrears, subject to the facility documents and applicable law. The borrower acknowledges this charge as a reasonable estimate of the loss arising from default. Bounced cheques attract KES 5,000 per cheque and cheque stoppage attracts KES 2,500, subject to applicable law.</li><li><strong>Tracking device:</strong> A tracking device must be installed and maintained on the secured vehicle at the borrower's cost until the loan is repaid and all liabilities discharged. Where tracker fees are deducted for only part of the tenor, Spectrum Credit may debit applicable tracker fees for the remaining period to the loan account. The borrower is responsible for tampering with, damaging or losing the device.</li><li><strong>Tracker fault and repossession:</strong> If the tracking device develops a technical fault, the borrower must cooperate with Spectrum Credit and the service provider and make the vehicle available for repairs. If the borrower fails to cooperate, Spectrum Credit may take recovery steps permitted by the facility documents and applicable law.</li><li>The borrower authorizes Spectrum Credit to repossess the collateral where the borrower defaults, disposes of or tampers with the collateral, or otherwise prejudices Spectrum Credit's rights. Recovery and disposal will be undertaken in accordance with applicable law and required notices, and related costs are payable by the borrower.</li><li>Claims, costs and expenses arising from breach or enforcement—including insurance renewals, demand charges, tracking fees, auctioneer fees, towing, storage, legal fees and disbursements—may be debited to the loan account and recovered by lawful means.</li><li>Each provision of this letter is severable. If any provision is held invalid or unenforceable, the remaining provisions continue in full force and effect.</li><li>Where the facility is cancelled in writing before disbursement, the borrower remains liable for origination costs already incurred, including reasonable tracker removal and logbook discharge costs where applicable. If the vehicle is not made available for tracker removal within seven (7) days after cancellation, applicable tracker maintenance fees may continue until removal. A facility cannot be cancelled after partial disbursement.</li><li>The borrower bears collateral discharge costs and must make the vehicle available for tracker removal within seven (7) days after settlement. Logbook discharge will not be completed until the tracker is removed.</li><li>Tax or withholding will be applied only to the extent required by law. Where a deduction or withholding is required by law, the amount payable will be adjusted only to the extent permitted by applicable law and the facility documents.</li><li>If a guarantor makes a payment under the facility, the borrower will indemnify the guarantor to the extent of that payment, and the guarantor may exercise applicable subrogation rights.</li><li>Where applicable, the guarantor consents to use and joint registration of the vehicle as security, guarantees payment and discharge of the borrower's obligations, and will indemnify Spectrum Credit against claims arising from the security, subject to applicable law and the security documents. No variation is valid unless made in writing and signed by the parties.</li></ol></li>
</ol>
<div class="section buyoff-fees-start">Buy-off and fees schedule</div><table class="fees"><thead><tr><th>Facility / deduction</th><th class="money">Amount (KES)</th></tr></thead><tbody>
<tr><td>Purpose of facility</td><td class="money">Buy-off</td></tr><tr><td>Gross facility amount</td><td class="money">${currency(principal)}</td>${feesRows}<tr class="total"><td>Total deductions</td><td class="money">${currency(totalDeductions)}</td></tr><tr class="total"><td>Net amount after deductions</td><td class="money">${currency(netAmount)}</td></tr><tr><td>Buy-off balance (as provided)</td><td class="money">${currency(buyoffBalance)}</td></tr><tr><td>Client contribution required (if any)</td><td class="money">${currency(clientContribution)}</td></tr>
</tbody></table><p class="small">Fees shown are estimates based on the stated charges; taxes and verified third-party costs may vary. The buy-off balance is subject to lender confirmation. If the net proceeds are insufficient to settle the confirmed balance and related charges, the client must provide the shortfall before completion.</p>
<p>Please sign below to confirm your unconditional acceptance of this offer and its terms.</p><p>Yours faithfully,<br><strong>For: Spectrum Credit Limited</strong></p>
<div class="signatures"><div class="sig">Loan Officer<br>Name: __________________________<br>Date: __________________________</div><div class="sig">Customer signature<br>Name: ${esc(customer)}<br>ID No: ${esc(application.idNumber || detail.idNumber || '—')} · Date: __________________</div></div>
<p class="small">This offer is subject to final approval, verification of the buy-off balance and completion of all legal, security and insurance formalities.</p><div class="buyoff-page-footer"><span>Loan Officer</span><span>Customer Signature</span></div></main></body></html>`;

    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const modal = document.getElementById('offer-letter-modal');
    const content = document.getElementById('offer-letter-content');
    const title = modal?.querySelector('.modal-title');
    if (!modal || !content) {
      window.open(url, '_blank', 'noopener');
      return;
    }
    if (title) title.textContent = 'Buy-off Offer Letter';
    content.innerHTML = `<div style="padding:12px"><div style="display:flex;justify-content:flex-end;margin-bottom:10px"><a class="btn btn-primary" href="${url}" download="buy-off-offer-${escapeHtml(application.id)}.html"><i class="ti ti-download"></i> Download Offer Letter</a></div><iframe title="Buy-off offer letter" src="${url}" style="display:block;width:100%;height:75vh;min-height:560px;border:1px solid #D0D5DD;border-radius:8px;background:#FFF"></iframe></div>`;
    modal.classList.add('active');
    application.offerLetterGeneratedAt = new Date().toISOString();
    application.audit = Array.isArray(application.audit) ? application.audit : [];
    application.audit.unshift({ action: 'Buy-off offer letter generated with insurance terms', by: DataStore.get().roles?.[DataStore.get().activeRole]?.title || DataStore.get().activeRole, at: new Date().toISOString().slice(0, 16).replace('T', ' ') });
    DataStore.save(data);
  };

  LOSModule.generateBuyoffOfferLetter = applicationId => {
    if (!requireCreditAdmin()) return;
    const application = (DataStore.get().applications || []).find(item => item.id === applicationId);
    if (!application || application.loanType !== 'BUY_OFF') return;
    renderOfferLetter(application);
  };

  LOSModule.generateAssetFinanceOfferLetter = applicationId => {
    if (!requireCreditAdmin()) return;
    const application = (DataStore.get().applications || []).find(item => item.id === applicationId);
    if (!application || application.loanType !== 'ASSET_FINANCE') return;
    renderAssetFinanceOfferLetter(application);
  };

  LOSModule.generateStraightLoanOfferLetter = applicationId => {
    if (!requireCreditAdmin()) return;
    const application = (DataStore.get().applications || []).find(item => item.id === applicationId);
    if (!application || application.loanType !== 'STRAIGHT_LOAN') return;
    renderAssetFinanceOfferLetter(application);
  };

  // Route existing offer-letter actions through these templates for insured facilities.
  Object.keys(LOSModule).forEach(name => {
    if (!/offer|letter/i.test(name) || !/generate|print|show|open|create|preview/i.test(name) || name === 'generateBuyoffOfferLetter') return;
    const original = LOSModule[name];
    if (typeof original !== 'function') return;
    LOSModule[name] = function (...args) {
      if (!requireCreditAdmin()) return;
      const application = applicationFor(args);
      if (application?.loanType === 'BUY_OFF') return renderOfferLetter(application);
      if (application?.loanType === 'ASSET_FINANCE' || application?.loanType === 'STRAIGHT_LOAN') return renderAssetFinanceOfferLetter(application);
      return original.apply(this, args);
    };
  });

  const addDetailAction = () => {
    const data = DataStore.get();
    const application = (data.applications || []).find(item => item.id === data.selectedAppId);
    const container = document.getElementById('app-detail-content');
    if (!container) return;
    if (data.activeRole !== 'CREDIT_ADMIN') {
      container.querySelector('[data-facility-offer-letter]')?.remove();
      return;
    }
    if (!application || !['BUY_OFF', 'ASSET_FINANCE', 'STRAIGHT_LOAN'].includes(application.loanType) || container.querySelector('[data-facility-offer-letter]')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-primary';
    button.dataset.facilityOfferLetter = '1';
    button.style.cssText = 'margin:0 0 12px';
    const isBuyoff = application.loanType === 'BUY_OFF';
    const isStraightLoan = application.loanType === 'STRAIGHT_LOAN';
    const label = isBuyoff ? 'Buy-off' : isStraightLoan ? 'Straight Loan' : 'Asset Finance';
    button.innerHTML = `<i class="ti ti-file-text"></i> Generate ${label} Offer Letter`;
    button.addEventListener('click', () => isBuyoff
      ? LOSModule.generateBuyoffOfferLetter(application.id)
      : isStraightLoan
        ? LOSModule.generateStraightLoanOfferLetter(application.id)
        : LOSModule.generateAssetFinanceOfferLetter(application.id));
    container.prepend(button);
  };
  const observer = new MutationObserver(addDetailAction);
  const start = () => {
    const container = document.getElementById('app-detail-content');
    if (container) observer.observe(container, { childList: true, subtree: true });
    addDetailAction();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
