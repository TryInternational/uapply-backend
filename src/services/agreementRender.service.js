const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Handlebars = require('handlebars');
const { DateTime } = require('luxon');
const logger = require('../config/logger');

/**
 * Turns an Agreement (+ the tenant's agreement settings) into the bilingual
 * HTML, and the HTML into an A4 PDF with a "Agreement No · page X of Y" footer.
 *
 * The template is the one the business supplied (templates/agreements/
 * sub-agent-agreement.hbs); this file only fills it. Rendering is pure — the
 * same document and the same settings always give the same bytes — which is
 * what lets the certificate page carry a hash that can be checked later.
 */

const TEMPLATE_VERSION = '2026-11';
const TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'agreements', 'sub-agent-agreement.hbs');
const TZ = 'Asia/Kuwait';

let compiled;
const template = () => {
  if (!compiled) compiled = Handlebars.compile(fs.readFileSync(TEMPLATE_PATH, 'utf8'));
  return compiled;
};

// ---------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------

const CURRENCY_AR = {
  GBP: 'جنيه إسترليني',
  USD: 'دولار أمريكي',
  EUR: 'يورو',
  KWD: 'دينار كويتي',
  AED: 'درهم إماراتي',
  SAR: 'ريال سعودي',
  QAR: 'ريال قطري',
  BHD: 'دينار بحريني',
  OMR: 'ريال عُماني',
  CAD: 'دولار كندي',
  AUD: 'دولار أسترالي',
  TRY: 'ليرة تركية',
  MYR: 'رينغيت ماليزي',
};

const fmtNumber = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return String(n);
  // Western digits in both languages, as on the business's own template.
  return v % 1 === 0
    ? v.toLocaleString('en-GB')
    : v.toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
};

/** The commission sentence fragments, EN and AR, from the structured deal. */
const commissionText = (commission) => {
  if (!commission) return { en: '', ar: '' };
  if (commission.type === 'percentage') {
    const v = fmtNumber(commission.value);
    return {
      en: `${v}% of the first-year tuition fee`,
      ar: `${v}٪ من رسوم السنة الدراسية الأولى`,
    };
  }
  const cur = String(commission.currency || 'GBP').toUpperCase();
  const v = fmtNumber(commission.value);
  return {
    en: `${cur} ${v} per student`,
    ar: `${v} ${CURRENCY_AR[cur] || cur} عن كل طالب`,
  };
};

const fmtDate = (d) => (d ? DateTime.fromJSDate(new Date(d)).setZone(TZ).toFormat('dd/MM/yyyy') : '');
const fmtDateTime = (d) => (d ? DateTime.fromJSDate(new Date(d)).setZone(TZ).toFormat('dd/MM/yyyy HH:mm') : '');

const EVENT_LABEL = {
  created: 'Agreement drafted',
  sent: 'Sent for signature',
  resent: 'Signing link re-sent',
  viewed: 'Opened by the signer',
  agent_signed: 'Signed by the Second Party',
  agent_declined: 'Declined by the Second Party',
  countersigned: 'Countersigned by the First Party',
  completed: 'Completed — both parties signed',
  voided: 'Voided',
  expired: 'Signing link expired',
  reminder_sent: 'Reminder emailed',
  invite_sent: 'Portal invite emailed',
};

/** Shorten a user agent to something a human can read on one line. */
const shortUa = (ua) => {
  if (!ua) return '';
  const s = String(ua);
  const pick = (re, name) => {
    const m = re.exec(s);
    return m ? `${name} ${m[1].split('.')[0]}` : null;
  };
  const browser =
    pick(/Edg\/([\d.]+)/, 'Edge') ||
    pick(/Chrome\/([\d.]+)/, 'Chrome') ||
    pick(/Firefox\/([\d.]+)/, 'Firefox') ||
    pick(/Version\/([\d.]+).*Safari/, 'Safari') ||
    'Browser';
  let os = '';
  if (/iPhone|iPad/.test(s)) os = 'iOS';
  else if (/Android/.test(s)) os = 'Android';
  else if (/Mac OS X/.test(s)) os = 'macOS';
  else if (/Windows/.test(s)) os = 'Windows';
  else if (/Linux/.test(s)) os = 'Linux';
  return [browser, os].filter(Boolean).join(' · ');
};

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

/**
 * @param {object} agreement   the Agreement document (or a plain draft shaped like one)
 * @param {object} settings    the AgreementSetting document
 * @param {object} [opts]
 * @param {string} [opts.agentSignatureSrc]    data URL of the agent's signature PNG
 * @param {string} [opts.companySignatureSrc]  data URL of the company signature PNG
 * @param {boolean} [opts.withCertificate]     append the certificate page
 */
const buildContext = (agreement, settings, opts = {}) => {
  const a = agreement || {};
  const s = settings || {};
  const company = s.company || {};
  const signatory = s.signatory || {};
  const agent = a.agent || {};
  const sig = a.signatures || {};
  const text =
    a.commission && a.commission.textEn
      ? { en: a.commission.textEn, ar: a.commission.textAr }
      : commissionText(a.commission);

  const ctx = {
    template_version: a.templateVersion || TEMPLATE_VERSION,
    agreement_no: a.agreementNo || 'DRAFT',
    agreement_date: fmtDate(a.agreementDate || a.sentAt || new Date()),

    company_name_en: company.nameEn,
    company_name_ar: company.nameAr,
    company_city_en: company.cityEn,
    company_city_ar: company.cityAr,
    signatory_name_en: signatory.nameEn,
    signatory_name_ar: signatory.nameAr,
    signatory_civil_id: signatory.civilId,

    agent_org_en: agent.organisationEn || '',
    agent_org_ar: agent.organisationAr || '',
    agent_name_en: agent.nameEn || '',
    agent_name_ar: agent.nameAr || agent.nameEn || '',
    agent_civil_id: agent.civilId || '—',
    agent_mobile: agent.mobile || '—',
    agent_email: agent.email || '',

    commission_en: text.en,
    commission_ar: text.ar,
    extra_terms: Array.isArray(a.extraTerms) ? a.extraTerms.filter((t) => t && t.en) : [],

    company_signature_src: opts.companySignatureSrc || '',
    company_signed_class: opts.companySignatureSrc ? 'signed' : '',
    company_signed_at: sig.company && sig.company.signedAt ? fmtDateTime(sig.company.signedAt) : '',
    company_ip: (sig.company && sig.company.ip) || '',

    agent_signature_src: opts.agentSignatureSrc || '',
    agent_signed_class: opts.agentSignatureSrc ? 'signed' : '',
    agent_signed_at: sig.agent && sig.agent.signedAt ? fmtDateTime(sig.agent.signedAt) : '',
    agent_ip: (sig.agent && sig.agent.ip) || '',
  };

  if (opts.withCertificate) {
    const events = (a.events || []).map((e) => ({
      at: fmtDateTime(e.at),
      label: EVENT_LABEL[e.type] || e.type,
      by:
        e.byName ||
        (e.type === 'viewed' || e.type === 'agent_signed' || e.type === 'agent_declined' ? agent.nameEn : '') ||
        '',
      ip: e.ip || '',
      ua: shortUa(e.userAgent),
    }));
    ctx.certificate = {
      generated_at: fmtDateTime(new Date()),
      document_hash: a.documentHash || '',
      agent_email: (sig.agent && sig.agent.email) || agent.email || '',
      agent_auth: 'Single-use link emailed to the signer; link opened and signed from the IP addresses below',
      agent_method:
        sig.agent && sig.agent.method === 'typed'
          ? `Typed name "${sig.agent.typedName || agent.nameEn}" adopted as signature`
          : 'Hand-drawn on screen',
      company_by: sig.company && sig.company.byName ? sig.company.byName : '',
      consent_text: (sig.agent && sig.agent.consentText) || '',
      events,
    };
  }
  return ctx;
};

const renderHtml = (agreement, settings, opts) => template()(buildContext(agreement, settings, opts));

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

let browserPromise = null;

/**
 * One Chromium per process, launched on first use and re-launched if it dies.
 * `puppeteer` downloads its own browser on `npm install`; in the Docker image
 * that download is skipped and PUPPETEER_EXECUTABLE_PATH points at the
 * distro's chromium (see Dockerfile).
 */
const getBrowser = async () => {
  if (browserPromise) {
    const b = await browserPromise.catch(() => null);
    if (b && b.connected !== false && (typeof b.isConnected !== 'function' || b.isConnected())) return b;
    browserPromise = null;
  }
  // eslint-disable-next-line global-require, import/no-unresolved
  const puppeteer = require('puppeteer');
  browserPromise = puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--font-render-hinting=none',
    ],
  });
  const browser = await browserPromise;
  browser.on('disconnected', () => {
    browserPromise = null;
  });
  return browser;
};

const closeBrowser = async () => {
  if (!browserPromise) return;
  const b = await browserPromise.catch(() => null);
  browserPromise = null;
  if (b) await b.close().catch(() => {});
};

const footerTemplate = (agreementNo) => `
  <div style="width:100%; font-family:Inter,Helvetica,Arial,sans-serif; font-size:7.5pt; color:#6b7280; padding:0 14mm; display:flex; justify-content:space-between; align-items:center;">
    <span>Sub-Agent Agreement · ${String(agreementNo || '').replace(/[<>&]/g, '')} · Ulearn Abroad</span>
    <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
  </div>`;

/** Best-effort page count from the PDF bytes (Chrome writes plain page dictionaries). */
const countPages = (buf) => {
  const m = buf.toString('latin1').match(/\/Type\s*\/Page(?![s])/g);
  return m ? m.length : undefined;
};

/**
 * HTML → PDF buffer. A4, backgrounds on, CSS page size honoured, footer with
 * the agreement number and "Page X of Y" on every page.
 */
const htmlToPdf = async (html, { agreementNo } = {}) => {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: ['load', 'networkidle0'], timeout: 45000 });
    // Web fonts (Inter, Noto Naskh Arabic) finish after `load`; without this the
    // first render falls back to the system Arabic face.
    // eslint-disable-next-line no-undef
    await page.evaluate(() => (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()));
    const buf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: footerTemplate(agreementNo),
      margin: { top: '15mm', right: '14mm', bottom: '18mm', left: '14mm' },
    });
    const buffer = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    return { buffer, pages: countPages(buffer), sha256: crypto.createHash('sha256').update(buffer).digest('hex') };
  } finally {
    await page.close().catch((e) => logger.warn(`agreement pdf: page close failed: ${e.message}`));
  }
};

const renderPdf = async (agreement, settings, opts) => {
  const html = renderHtml(agreement, settings, opts);
  return htmlToPdf(html, { agreementNo: agreement && agreement.agreementNo });
};

module.exports = {
  TEMPLATE_VERSION,
  commissionText,
  buildContext,
  renderHtml,
  htmlToPdf,
  renderPdf,
  closeBrowser,
  fmtDate,
  fmtDateTime,
};
