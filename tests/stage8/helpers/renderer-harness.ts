/**
 * A minimal DOM harness for the Stage 8 renderer tests.
 *
 * WHY THIS EXISTS
 * The project has ZERO runtime dependencies, so there is no JSDOM and no test
 * framework. Rather than settle for source-text assertions - which prove what
 * the code says, not what it does - this harness builds just enough of a DOM to
 * RUN THE REAL COMPILED BUNDLE in a `node:vm` context and drive it the way a
 * user does: fill the form, submit, click logout.
 *
 * The element registry is parsed out of the REAL `index.html`, so a test cannot
 * pass against ids the shipped markup does not actually contain. If the markup
 * and the script ever disagree about an id, every test here fails loudly.
 *
 * WHAT IS DELIBERATELY ABSENT
 * The sandbox has no `require`, no `process`, no `module` and no filesystem. If
 * the renderer ever reached for one of them the bundle would throw at load time,
 * which is itself part of what these tests prove.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';

/** A recorded call into the preload bridge. */
export interface ApiCall {
  readonly name: string;
  readonly args: readonly unknown[];
}

/** One element of the fake tree. */
class FakeElement {
  public value = '';
  public type = '';
  public disabled = false;
  public hidden = false;
  public tagName = 'div';
  public id = '';
  public readonly dataset: Record<string, string> = {};
  public readonly attributes: Record<string, string> = {};
  public readonly classes = new Set<string>();
  private readonly listeners = new Map<string, ((event: FakeEvent) => void)[]>();
  private text = '';
  private childNodes: FakeElement[] = [];

  public constructor(tagName: string) {
    this.tagName = tagName;
  }

  /**
   * `textContent` mirrors the DOM: assigning it REPLACES the subtree.
   *
   * This matters. A plain field would let a renderer "clear" a list without
   * clearing its rows, and every test would still pass while the browser showed
   * stale rows - the exact class of bug this harness exists to catch.
   */
  public get textContent(): string {
    return this.text + this.childNodes.map((child) => child.textContent).join('');
  }

  public set textContent(value: string) {
    this.text = value;
    this.childNodes = [];
  }

  public get children(): readonly FakeElement[] {
    return this.childNodes;
  }

  public get classList(): { readonly toggle: (name: string, force: boolean) => void } {
    return {
      toggle: (name: string, force: boolean): void => {
        if (force) {
          this.classes.add(name);
        } else {
          this.classes.delete(name);
        }
      },
    };
  }

  public setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
    if (name === 'id') {
      this.id = value;
    }
  }

  public getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  public removeAttribute(name: string): void {
    delete this.attributes[name];
  }

  public append(...nodes: FakeElement[]): void {
    for (const node of nodes) {
      this.childNodes.push(node);
    }
  }

  public addEventListener(type: string, handler: (event: FakeEvent) => void): void {
    const existing = this.listeners.get(type) ?? [];
    existing.push(handler);
    this.listeners.set(type, existing);
  }

  /**
   * Dispatches synchronously, exactly as a browser does for `submit` and
   * `click`. Handlers here are `void`-invoked async functions, so the caller
   * settles the returned promises afterwards.
   */
  public dispatchEvent(event: FakeEvent): void {
    // `target` matters: the search handler reads its value from the event rather
    // than a captured reference, exactly as a browser delivers it.
    event.target = this;
    for (const handler of this.listeners.get(event.type) ?? []) {
      handler(event);
    }
  }

  /**
   * `showModal`/`close` for the user dialog.
   *
   * The renderer prefers the real methods and falls back to the `hidden`
   * property, so a harness that provides them exercises the same code path a
   * browser would.
   */
  public showModal(): void {
    this.hidden = false;
  }

  public close(): void {
    this.hidden = true;
  }

  public get dialogOpen(): boolean {
    return !this.hidden;
  }

  /** Supports `tag`, `[attr]` and `.class` - the three shapes the renderer uses. */
  public querySelectorAll(selector: string): FakeElement[] {
    const found: FakeElement[] = [];
    const visit = (node: FakeElement): void => {
      for (const child of node.children) {
        if (matches(child, selector)) {
          found.push(child);
        }
        visit(child);
      }
    };
    visit(this);
    return found;
  }
}

/** A synthetic event carrying the `preventDefault` and `target` the handlers use. */
export class FakeEvent {
  public prevented = false;
  public target: FakeElement | null = null;

  public constructor(public readonly type: string) {}

  public preventDefault(): void {
    this.prevented = true;
  }
}

function matches(element: FakeElement, selector: string): boolean {
  if (selector.startsWith('[')) {
    const name = selector.slice(1, -1);
    return Object.prototype.hasOwnProperty.call(element.attributes, name);
  }
  if (selector.startsWith('.')) {
    return element.classes.has(selector.slice(1));
  }
  return element.tagName === selector;
}

/** The fake document. */
class FakeDocument {
  public readyState = 'loading';
  public readonly body = new FakeElement('body');
  public readonly documentElement = new FakeElement('html');
  private readonly registry = new Map<string, FakeElement>();
  private readonly listeners = new Map<string, ((event: FakeEvent) => void)[]>();
  private counter = 0;

  public register(element: FakeElement): void {
    if (element.id !== '') {
      this.registry.set(element.id, element);
    }
    // Everything lives under one root, so a document-level querySelectorAll
    // finds exactly the elements the markup declares.
    this.body.append(element);
    this.counter += 1;
  }

  public get declaredElementCount(): number {
    return this.counter;
  }

  public getElementById(id: string): FakeElement | null {
    return this.registry.get(id) ?? null;
  }

  public querySelectorAll(selector: string): FakeElement[] {
    return this.body.querySelectorAll(selector);
  }

  public createElement(tagName: string): FakeElement {
    return new FakeElement(tagName);
  }

  public addEventListener(type: string, handler: (event: FakeEvent) => void): void {
    const existing = this.listeners.get(type) ?? [];
    existing.push(handler);
    this.listeners.set(type, existing);
  }

  public dispatchEvent(event: FakeEvent): void {
    for (const handler of this.listeners.get(event.type) ?? []) {
      handler(event);
    }
  }
}

/** A safe authentication state with no token field, exactly as Stage 7 returns. */
export interface FakeSafeAuthState {
  readonly authenticated: boolean;
  readonly uid: string | null;
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly expirationTimeIso: string | null;
  readonly displayName?: string | null;
  readonly role?: string | null;
}

/** The signed-out state the shell should see on a fresh start. */
export const SIGNED_OUT: FakeSafeAuthState = Object.freeze({
  authenticated: false,
  uid: null,
  email: null,
  emailVerified: false,
  expirationTimeIso: null,
});

/** How the fake backend should answer each named operation. */
export interface FakeBackendOptions {
  readonly stateOnStartup?: FakeSafeAuthState;
  /** Returned by `auth.signIn`. Set `success: false` to simulate a refusal. */
  readonly signInResult?: {
    readonly success: boolean;
    readonly authState: FakeSafeAuthState;
    readonly error?: { readonly code: string; readonly message: string };
  };
  /** The state `auth.getState` returns AFTER a successful sign-in. */
  readonly stateAfterSignIn?: FakeSafeAuthState;
  readonly throwOnGetState?: boolean;
  readonly throwOnSignIn?: boolean;
  readonly throwOnSignOut?: boolean;
  // ---- Stage 10: the medicines operations ----
  readonly medicinesList?: { readonly ok: boolean; readonly medicines?: readonly unknown[]; readonly error?: { readonly code: string; readonly message: string; readonly retryable: boolean } };
  readonly medicinesUpdate?: { readonly ok: boolean; readonly error?: { readonly code: string; readonly message: string; readonly retryable: boolean } };
  readonly throwOnMedicinesList?: boolean;
  readonly throwOnMedicinesUpdate?: boolean;
  // ---- Stage 11: the order-requests operations ----
  readonly orderRequestsList?: { readonly ok: boolean; readonly orders?: readonly unknown[]; readonly error?: { readonly code: string; readonly message: string; readonly retryable: boolean } };
  readonly orderRequestsGet?: { readonly ok: boolean; readonly order?: Record<string, unknown> | null; readonly error?: { readonly code: string; readonly message: string; readonly retryable: boolean } };
  readonly orderRequestsGetSequence?: readonly { readonly ok: boolean; readonly order?: Record<string, unknown> | null; readonly error?: { readonly code: string; readonly message: string; readonly retryable: boolean } }[];
  readonly orderRequestsGetGates?: readonly (Promise<void> | undefined)[];
  readonly throwOnOrderRequestsGet?: boolean;
  // ---- Stage 16: employee order-request submission ----
  readonly orderRequestSubmit?: { readonly ok: boolean; readonly requestId?: string; readonly error?: { readonly code: string; readonly message: string; readonly retryable: boolean } };
  readonly orderRequestSubmitGate?: Promise<void>;
  readonly throwOnOrderRequestSubmit?: boolean;
  readonly ordersProcess?: { readonly ok: boolean; readonly outcome?: unknown; readonly error?: { readonly code: string; readonly message: string; readonly retryable: boolean } };
  readonly throwOnOrderRequestsList?: boolean;
  readonly throwOnOrdersProcess?: boolean;
  // ---- Stage 12/23: the READ-ONLY orders history ----
  /**
   * What `orders.list()` answers, as `OrderHistoryItemView` rows.
   *
   * These are the EXACT fields the Main process projects, so a test that builds a
   * row here is exercising the same shape the renderer really receives. There is
   * deliberately no `update` or `process` option: the history page owns no write,
   * so the harness offers nothing to stage one.
   */
  readonly ordersList?: { readonly ok: boolean; readonly orders?: readonly unknown[]; readonly hasMore?: boolean; readonly error?: { readonly code: string; readonly message: string; readonly retryable: boolean } };
  readonly ordersListSequence?: readonly { readonly ok: boolean; readonly orders?: readonly unknown[]; readonly hasMore?: boolean; readonly error?: { readonly code: string; readonly message: string; readonly retryable: boolean } }[];
  readonly ordersListGate?: Promise<void>;
  readonly ordersListGateSequence?: readonly (Promise<void> | undefined)[];
  readonly ordersLoadMoreSequence?: readonly { readonly ok: boolean; readonly orders?: readonly unknown[]; readonly hasMore?: boolean; readonly error?: { readonly code: string; readonly message: string; readonly retryable: boolean } }[];
  readonly ordersLoadMoreGate?: Promise<void>;
  readonly ordersLoadMoreGateSequence?: readonly (Promise<void> | undefined)[];
  readonly throwOnOrdersList?: boolean;
  readonly throwOnOrdersLoadMore?: boolean;
  // ---- Stage 17: the read-only authenticated user's order history ----
  readonly ordersMyHistory?: { readonly ok: boolean; readonly orders?: readonly unknown[]; readonly error?: { readonly code: string; readonly message: string; readonly retryable: boolean } };
  readonly ordersMyHistoryGate?: Promise<void>;
  readonly throwOnOrdersMyHistory?: boolean;
  /**
   * Stage 13: what `settings.get()` answers. Set `ok: false` to simulate a refusal.
   *
   * There is deliberately NO `settingsSave` option here either. The harness
   * cannot stage a write for a page that owns none, so a test could not exercise
   * one even by mistake.
   */
  readonly settingsGet?: { readonly ok: boolean; readonly settings?: unknown; readonly error?: { readonly code: string; readonly message: string; readonly retryable: boolean } };
  /**
   * Answers for `settings.get()`, one per call, in order.
   *
   * A RETRY that recovers can only be tested with a backend that changes its
   * mind: the first read fails, the second succeeds. `settingsGet` alone cannot
   * express that, because it gives the same answer forever, which would prove
   * only that the page retries - not that it recovers. The last entry is
   * repeated once the sequence runs out, so a test that reads more times than
   * it staged still gets a defined answer instead of `undefined`.
   */
  readonly settingsGetSequence?: readonly { readonly ok: boolean; readonly settings?: unknown; readonly error?: { readonly code: string; readonly message: string; readonly retryable: boolean } }[];
  readonly throwOnSettingsGet?: boolean;
  /**
   * Stage 14: what `stockLogs.list()` answers. Set `ok: false` to simulate the
   * rules refusal an employee really receives (`stock_logs` is admin-only).
   *
   * There is deliberately NO write option here, not even one that throws: the fake
   * backend cannot be asked to move stock at all, so "this page cannot write" is
   * a property of the harness and not only of the code under test.
   */
  readonly stockLogsList?: { readonly ok: boolean; readonly movements?: readonly unknown[]; readonly error?: { readonly code: string; readonly message: string; readonly retryable: boolean } };
  /** Answers for `stockLogs.list()`, one per call, in order (for refresh tests). */
  readonly stockLogsListSequence?: readonly { readonly ok: boolean; readonly movements?: readonly unknown[]; readonly error?: { readonly code: string; readonly message: string; readonly retryable: boolean } }[];
  readonly throwOnStockLogsList?: boolean;
  // ---- Stage 19: movements for the selected manager order ----
  readonly stockLogsByOrder?: { readonly ok: boolean; readonly movements?: readonly unknown[]; readonly error?: { readonly code: string; readonly message: string; readonly retryable: boolean } };
  readonly stockLogsByOrderSequence?: readonly { readonly ok: boolean; readonly movements?: readonly unknown[]; readonly error?: { readonly code: string; readonly message: string; readonly retryable: boolean } }[];
  readonly stockLogsByOrderGate?: Promise<void>;
  readonly throwOnStockLogsByOrder?: boolean;
  /** What `users.list()` answers. Set `ok: false` to simulate a refusal. */
  readonly usersList?: { readonly ok: boolean; readonly users?: readonly unknown[]; readonly error?: { readonly code: string; readonly message: string; readonly retryable: boolean } };
  /** What `users.update()` answers. */
  readonly usersUpdate?: { readonly ok: boolean; readonly error?: { readonly code: string; readonly message: string; readonly retryable: boolean } };
  readonly throwOnUsersList?: boolean;
  readonly throwOnUsersUpdate?: boolean;
  /**
   * Applied to the user identified by the update payload, so a test can observe
   * that the renderer really re-reads what the server stored.
   */
  readonly onUsersUpdate?: (payload: Record<string, unknown>) => void;
}

/** The running harness: the fake DOM plus the recorded bridge calls. */
export interface RendererHarness {
  readonly document: FakeDocument;
  readonly calls: readonly ApiCall[];
  element(id: string): FakeElement;
  /** The five-state value mirrored onto `<body data-ui-state>`. */
  uiState(): string;
  /** Which view is currently visible. */
  visibleView(): 'login' | 'shell';
  callsTo(name: string): readonly ApiCall[];
  /** Fills the credentials and submits the real form, then settles. */
  submitLogin(email: string, password: string): Promise<void>;
  clickLogout(): Promise<void>;
  clickPasswordToggle(): void;
  clickNav(view: string): void;
  /** Opens the users page and settles the load it triggers. */
  openUsers(): Promise<void>;
  /** Types into the search box and settles; sends no request. */
  searchUsers(term: string): void;
  /** Clicks the refresh action and settles. */
  clickRefresh(): Promise<void>;
  /** The rendered `<tr>` elements of the users table. */
  userRows(): readonly FakeElement[];
  /** The rendered cell texts of one row. */
  rowCells(row: FakeElement): readonly string[];
  /** Opens the details dialog for a uid and settles. */
  openUserDialog(uid: string): void;
  /** Whether the details dialog is currently open. */
  userDialogOpen(): boolean;
  /** Types a new name into the dialog. */
  typeUserName(value: string): void;
  /** Clicks one dialog action and settles. */
  clickUserAction(action: 'save' | 'approve' | 'reject' | 'grant' | 'revoke'): Promise<void>;
  /** The dialog's safe error message, or `null` when it is hidden. */
  userDialogError(): string | null;
  /** The users page state, from `data-view-state`. */
  usersViewState(): string;
  // ---- Stage 10: the medicines module ----
  /** Opens the medicines page and settles the load it triggers. */
  openMedicines(): Promise<void>;
  /** Types into the catalogue search box and settles; sends no request. */
  searchMedicines(term: string): void;
  /** Clicks the catalogue refresh action and settles. */
  clickMedicinesRefresh(): Promise<void>;
  /** The rendered `<tr>` elements of the catalogue table. */
  medicineRows(): readonly FakeElement[];
  /** The rendered cell texts of one catalogue row. */
  medicineRowCells(row: FakeElement): readonly string[];
  /** Opens the medicine dialog for an id and settles. */
  openMedicineDialog(medicineId: string): void;
  /** Whether the medicine dialog is currently open. */
  medicineDialogOpen(): boolean;
  /** Types a new cap into the medicine dialog. */
  typeMaxQuantity(value: string): void;
  /** Clicks the medicine dialog's save action and settles. */
  clickMedicineSave(): Promise<void>;
  /** The dialog's safe error message, or `null` when it is hidden. */
  medicineDialogError(): string | null;
  /** The medicines page state, from `data-view-state`. */
  medicinesViewState(): string;
  // ---- Stage 11: the order-requests module ----
  /** Opens the queue page and settles the load it triggers. */
  openOrders(): Promise<void>;
  /** Types into the queue search box and settles; sends no request. */
  searchOrders(term: string): void;
  /** Chooses a status in the filter and settles; sends no request. */
  filterOrdersByStatus(value: string): void;
  /** Clicks the queue refresh action and settles. */
  clickOrdersRefresh(): Promise<void>;
  /** The rendered `<tr>` elements of the queue table. */
  orderRows(): readonly FakeElement[];
  /** The rendered cell texts of one queue row. */
  orderRowCells(row: FakeElement): readonly string[];
  /** Opens the request dialog for an id. */
  openOrderDialog(requestId: string): void;
  /** Whether the request dialog is currently open. */
  orderDialogOpen(): boolean;
  /** Whether the confirmation dialog is currently open. */
  orderConfirmOpen(): boolean;
  /** Clicks the process action; opens the confirmation but does NOT process. */
  clickProcessOrder(): Promise<void>;
  /** Clicks the confirmation's accept action and settles. */
  clickConfirmOrder(): Promise<void>;
  /** The details dialog's safe error message, or `null` when hidden. */
  orderDialogError(): string | null;
  /** The employee shown in the details dialog. */
  orderDetailEmployee(): string;
  /** The status shown in the details dialog. */
  orderDetailStatus(): string;
  /** The order id shown in the details dialog. */
  orderDetailOrderId(): string;
  /** The requested lines shown in the details dialog, as `[name, quantity]`. */
  orderDetailItems(): readonly (readonly string[])[];
  /** The post-attempt outcome line, or `null` when hidden. */
  orderOutcomeMessage(): string | null;
  /** The queue page state, from `data-view-state`. */
  ordersViewState(): string;
  // ---- Stage 16: employee request submission ----
  openRequestSubmission(): Promise<void>;
  chooseRequestMedicine(medicineId: string): void;
  typeRequestQuantity(value: string): void;
  addRequestItem(): void;
  clickRequestSubmit(): Promise<void>;
  requestItems(): readonly (readonly string[])[];
  requestSubmitState(): string;
  requestSubmitMessage(): string;
  clickRequestStatusRefresh(): Promise<void>;
  requestStatusState(): string;
  requestStatusRequestId(): string;
  requestStatusMessage(): string;
  // ---- Stage 12: the read-only orders-history module ----
  /** Opens the history page and settles the load it triggers. */
  openOrdersHistory(): Promise<void>;
  /** Types into the history search box; sends no request. */
  searchOrdersHistory(term: string): void;
  /** Chooses a status in the history filter; sends no request. */
  filterOrdersHistoryByStatus(value: string): void;
  /** Clicks the history refresh action and settles. */
  clickOrdersHistoryRefresh(): Promise<void>;
  /** Clicks Load More and settles; the renderer supplies no paging token. */
  clickOrdersHistoryLoadMore(): Promise<void>;
  /** Clicks the local print action; no backend operation is invoked. */
  clickOrdersHistoryPrint(): void;
  /** The rendered `<tr>` elements of the history table. */
  orderHistoryRows(): readonly FakeElement[];
  /** The rendered cell texts of one history row. */
  orderHistoryRowCells(row: FakeElement): readonly string[];
  /** The history page state, from `data-view-state`. */
  ordersHistoryViewState(): string;
  /** The safe error line shown by the history page, or `null` when not in error. */
  ordersHistoryError(): string | null;
  /** The row-count line the history page renders. */
  ordersHistoryCount(): string;
  /** Opens the read-only details dialog for an order id. */
  openOrderHistoryDialog(orderId: string): void;
  /** Whether the details dialog is currently open. */
  orderHistoryDialogOpen(): boolean;
  /** Closes the details dialog. */
  closeOrderHistoryDialog(): void;
  /** Every detail field of the dialog, as `id -> text`, for a flat assertion. */
  orderHistoryDetails(): Readonly<Record<string, string>>;
  /** The item rows in the dialog, as `[medicineName, quantity]`. */
  orderHistoryDetailItems(): readonly (readonly string[])[];
  /** Stage 19: movement detail states and stored rows inside the selected-order dialog. */
  orderHistoryMovementsState(): string;
  orderHistoryMovementsError(): string | null;
  orderHistoryMovementRows(): readonly FakeElement[];
  /**
   * Every control inside the history panel and its dialog, as `id -> tagName`.
   *
   * A test asserts this set is exactly the read-only vocabulary - refresh, retry,
   * search, filter, close, and the per-row "view" button. A control that could
   * write would have to appear here to be clickable at all.
   */
  orderHistoryControls(): readonly (readonly [string, string])[];
  /**
   * Every control id the SHIPPED `index.html` gives to the history panel and its
   * dialog, read as text with no DOM and no renderer involved.
   *
   * This is the check that cannot be satisfied by renderer code: a button that
   * exists only in the bundle does not appear here, and a button that exists only
   * in a test's expectations fails here.
   */
  orderHistoryButtonsInMarkup(): readonly string[];
  // ---- Stage 17: the read-only personal order-history view ----
  openMyOrderHistory(): Promise<void>;
  clickMyOrderHistoryRefresh(): Promise<void>;
  clickMyOrderHistoryPrint(): void;
  printCalls(): number;
  searchMyOrderHistory(term: string): void;
  filterMyOrderHistoryByStatus(value: string): void;
  clearMyOrderHistoryFilters(): void;
  myOrderHistoryRows(): readonly FakeElement[];
  myOrderHistoryRowCells(row: FakeElement): readonly string[];
  myOrderHistoryViewState(): string;
  myOrderHistoryError(): string | null;
  myOrderHistoryCount(): string;
  /** Stage 13 - the read-only settings page. */
  openSettings(): Promise<void>;
  clickSettingsRefresh(): Promise<void>;
  clickSettingsRetry(): Promise<void>;
  settingsViewState(): string;
  settingsError(): string | null;
  settingsValues(): Readonly<Record<string, string>>;
  settingsNotConfiguredVisible(): boolean;
  settingsMarkup(): string;
  settingsControlsInMarkup(): readonly string[];
  /**
   * Stage 14 - the READ-ONLY stock movement audit page.
   *
   * There is deliberately NO write method here: the fake backend accepts a
   * `stockLogsList` answer and nothing else, so a test could not ask the renderer
   * to move stock even if the page had a control for it.
   */
  openStockMovements(): Promise<void>;
  clickStockRefresh(): Promise<void>;
  clickStockRetry(): Promise<void>;
  searchStockMovements(term: string): void;
  filterStockMovementsByDirection(value: string): void;
  /** The rendered `<tr>` elements of the movement table. */
  stockRows(): readonly FakeElement[];
  /** The rendered cell texts of one movement row. */
  stockRowCells(row: FakeElement): readonly string[];
  /** The movement page state, from `data-view-state`. */
  stockViewState(): string;
  /** The safe error line shown by the movement page, or `null` when not in error. */
  stockError(): string | null;
  /** The row-count line the movement page renders. */
  stockCount(): string;
  /** The shipped `stock-view` panel as text, with HTML comments stripped. */
  stockMarkup(): string;
  /**
   * Every control inside the movement panel, as `id -> tagName`.
   *
   * A test asserts this set is exactly the read-only vocabulary - refresh, retry,
   * search and filter. A control that could move stock would have to appear here to
   * be clickable at all.
   */
  stockControls(): readonly (readonly [string, string])[];
  /** Every control id the SHIPPED `index.html` gives the movement panel. */
  stockButtonsInMarkup(): readonly string[];
  /**
   * The stored document for one request, as the fake server collection holds it.
   *
   * Lets a test assert what was persisted independently of what the renderer
   * displays, which is what distinguishes a row that moved because the document
   * moved from one that moved because the renderer guessed.
   */
  storedOrder(requestId: string): Record<string, unknown> | null;
  /** Awaits the microtask queue so the renderer's async handlers finish. */
  settle(): Promise<void>;
}

/**
 * The project root.
 *
 * This helper is compiled to `dist/tests/stage8/helpers/`, so it sits TWO levels
 * deeper than the test files beside it and needs four levels up to reach the
 * project root. Getting this wrong turns every test into a confusing ENOENT.
 */
const projectRoot = join(__dirname, '..', '..', '..', '..');

/**
 * Builds the fake DOM from the REAL `index.html`.
 *
 * Every element carrying an id is instantiated, and its `hidden` attribute is
 * honoured so the shell starts in the state the markup actually ships. Elements
 * marked `data-view` become the navigation buttons.
 */
function buildDocument(): FakeDocument {
  const html = readFileSync(join(projectRoot, 'src', 'renderer', 'index.html'), 'utf8');
  const document = new FakeDocument();

  const tagPattern = /<([a-zA-Z][\w-]*)((?:\s+[^<>]*?)?)\/?>/g;
  const attributePattern = /([\w:-]+)(?:="([^"]*)")?/g;

  for (const match of html.matchAll(tagPattern)) {
    const tagName = match[1] ?? 'div';
    const attributesText = match[2] ?? '';

    // EVERY attribute is captured, not just the two the renderer looks up. A
    // harness that invented a starting value would let a test pass against
    // markup the user never actually sees.
    const attributes = new Map<string, string>();
    for (const attribute of attributesText.matchAll(attributePattern)) {
      attributes.set(attribute[1] ?? '', attribute[2] ?? '');
    }

    const id = attributes.get('id') ?? '';
    if (id === '' && !attributes.has('data-view')) {
      continue;
    }

    const element = new FakeElement(tagName);
    for (const [name, value] of attributes) {
      element.setAttribute(name, value);
    }
    // The input `type` matters: the password control ships masked, and a test
    // that could not read it could not prove the toggle ever resets.
    element.type = attributes.get('type') ?? '';
    element.hidden = attributes.has('hidden');
    // A `<dialog>` is displayed by `showModal()` and by nothing else: the
    // `hidden` attribute plays no part in it, and a dialog that has never been
    // opened is not on screen. Honouring the attribute alone would report every
    // shipped dialog as already open, and "the dialog opened" would then assert
    // nothing at all.
    if (tagName.toLowerCase() === 'dialog' && !attributes.has('open')) {
      element.hidden = true;
    }
    document.register(element);
  }

  return document;
}

/**
 * Every control the shipped `index.html` gives to the Stage 12 history panel and
 * its read-only dialog, as `[id, tagName]`.
 *
 * WHY THE MARKUP AND NOT THE FAKE TREE: `buildDocument` deliberately registers
 * only the elements that carry an id, so the fake tree is FLAT. A walk of its
 * `children` would return an empty list and quietly assert nothing. Reading the
 * HTML is also the stronger claim - a control a user could click on to write an
 * order would have to exist in the shipped page, and this cannot be satisfied by
 * something present only in a test or only in the compiled bundle.
 */
function buildOrderHistoryControls(): readonly (readonly [string, string])[] {
  const html = readFileSync(join(projectRoot, 'src', 'renderer', 'index.html'), 'utf8');
  const panelStart = html.indexOf('<section class="panel" id="orders-history-view"');
  const dialogStart = html.indexOf('<dialog class="user-dialog" id="order-history-dialog"');
  assert.ok(panelStart >= 0, 'the shipped markup declares no orders-history panel');
  assert.ok(dialogStart >= 0, 'the shipped markup declares no order-history dialog');

  const panel = html.slice(panelStart, html.indexOf('</section>', panelStart));
  const dialog = html.slice(dialogStart, html.indexOf('</dialog>', dialogStart));

  const found: [string, string][] = [];
  for (const match of `${panel}${dialog}`.matchAll(/<(button|input|select)\b([^>]*)>/g)) {
    const id = /\bid="([^"]+)"/.exec(match[2] ?? '')?.[1] ?? '(no id)';
    found.push([id, match[1] ?? '']);
  }
  return found;
}

/**
 * Every control inside the movement panel, as `[id, tagName]`.
 *
 * Read from the SHIPPED markup rather than from the fake DOM, exactly as the
 * Stage 12 control list does. The fake document builds a flat registry of ids
 * rather than a real tree, so a `querySelectorAll` scoped to a panel finds
 * nothing - and a list that silently came back EMPTY would make the read-only
 * assertion vacuous.
 */
function buildStockControls(): readonly (readonly [string, string])[] {
  const html = readFileSync(join(projectRoot, 'src', 'renderer', 'index.html'), 'utf8');
  const panelStart = html.indexOf('<section class="panel" id="stock-view"');
  assert.ok(panelStart >= 0, 'the shipped markup declares no stock movement panel');

  const panel = html.slice(panelStart, html.indexOf('</section>', panelStart));
  const found: [string, string][] = [];
  for (const match of panel.matchAll(/<(button|input|select|textarea)\b([^>]*)>/g)) {
    const id = /\bid="([^"]+)"/.exec(match[2] ?? '')?.[1] ?? '(no id)';
    found.push([id, match[1] ?? '']);
  }
  return found;
}

/** A minimal `AppStatusPayload` for the status block. */
function statusPayload(): unknown {
  return {
    state: 'ready',
    heading: 'حالة التطبيق',
    label: 'يعمل',
    appName: 'drug-manager',
    version: '0.3.0',
    electronVersion: '44.4.5',
    nodeVersion: '24.19.0',
    locale: 'ar',
    rtl: true,
    startedAtIso: '2026-10-01T08:00:00.000Z',
  };
}

/** Waits for the renderer's `void`-invoked async handlers to settle. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

/**
 * The shipped `settings-view` section, straight out of `index.html`.
 *
 * Read from the REAL file rather than from a fixture, so a test cannot pass
 * against a panel the application does not actually ship. The slice stops at the
 * first `</section>`, which is this panel's own close: the panel holds no nested
 * section of its own.
 */
function readSettingsPanelHtml(): string {
  const html = readFileSync(join(projectRoot, 'src', 'renderer', 'index.html'), 'utf8');
  const start = html.indexOf('<section class="panel" id="settings-view"');
  assert.ok(start >= 0, 'the shipped markup declares no settings panel');
  return html.slice(start, html.indexOf('</section>', start));
}

/**
 * The shipped `stock-view` panel as raw text.
 *
 * Read from the real file rather than from the DOM, so a control that exists only
 * in a test's expectations - or only in the compiled bundle - fails here.
 */
function readStockPanelHtml(): string {
  const html = readFileSync(join(projectRoot, 'src', 'renderer', 'index.html'), 'utf8');
  const start = html.indexOf('<section class="panel" id="stock-view"');
  assert.ok(start >= 0, 'the shipped markup declares no stock movement panel');
  return html.slice(start, html.indexOf('</section>', start));
}

/**
 * Removes every `<!-- ... -->` comment, including multi-line ones.
 *
 * A checker reading markup as text has to ignore comments, because the browser
 * does. The settings panel documents its own absence of a form inside a
 * comment, and a naive text scan would read that note as the very thing it
 * denies.
 */
function stripHtmlComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, '');
}
/**
 * Loads the compiled renderer into a sandbox and returns a handle on it.
 *
 * The sandbox intentionally provides ONLY `document`, `window` and `console`.
 * There is no `require`, no `process` and no filesystem, so a bundle that tried
 * to reach for one would fail here exactly as it would in the real renderer.
 */
export async function createRendererHarness(
  options: FakeBackendOptions = {},
): Promise<RendererHarness> {
  const document = buildDocument();
  const calls: ApiCall[] = [];
  let ordersListCursor = 0;
  let ordersLoadMoreCursor = 0;
  const nextOrdersListAnswer = (): FakeBackendOptions['ordersList'] => {
    const sequence = options.ordersListSequence ?? [];
    const staged = sequence[Math.min(ordersListCursor, sequence.length - 1)];
    ordersListCursor += 1;
    return staged ?? options.ordersList;
  };
  const nextOrdersLoadMoreAnswer = (): NonNullable<FakeBackendOptions['ordersList']> | undefined => {
    const sequence = options.ordersLoadMoreSequence ?? [];
    const staged = sequence[Math.min(ordersLoadMoreCursor, sequence.length - 1)];
    ordersLoadMoreCursor += 1;
    return staged;
  };

  let currentState: FakeSafeAuthState = options.stateOnStartup ?? SIGNED_OUT;
  const afterSignIn = options.stateAfterSignIn ?? {
    authenticated: true,
    uid: 'uid-admin',
    email: 'admin@example.com',
    emailVerified: true,
    expirationTimeIso: '2026-10-01T09:00:00.000Z',
    displayName: 'Nour',
    role: 'admin',
  };

  const record = (name: string, ...args: readonly unknown[]): void => {
    calls.push({ name, args });
  };

  // Stage 13: a settings backend that can change its mind between calls. The
  // cursor is per harness, so two harnesses in one test file keep their own
  // sequences instead of sharing a position.
  const settingsSequence = options.settingsGetSequence ?? [];
  let settingsCursor = 0;
  const nextSettingsAnswer = (): FakeBackendOptions['settingsGet'] => {
    const staged = settingsSequence[Math.min(settingsCursor, settingsSequence.length - 1)];
    settingsCursor += 1;
    return staged ?? options.settingsGet;
  };

  // Stage 14: a movement backend that can change its mind between calls, so a
  // refresh test can prove the page really re-read rather than re-rendering its
  // cache. The cursor is per harness, exactly as for settings.
  const stockLogsSequence = options.stockLogsListSequence ?? [];
  let stockLogsCursor = 0;
  const nextStockLogsAnswer = (): FakeBackendOptions['stockLogsList'] => {
    const staged = stockLogsSequence[Math.min(stockLogsCursor, stockLogsSequence.length - 1)];
    stockLogsCursor += 1;
    return staged ?? options.stockLogsList;
  };
  const stockLogsByOrderSequence = options.stockLogsByOrderSequence ?? [];
  let stockLogsByOrderCursor = 0;
  const nextStockLogsByOrderAnswer = (): FakeBackendOptions['stockLogsByOrder'] => {
    const staged = stockLogsByOrderSequence[
      Math.min(stockLogsByOrderCursor, stockLogsByOrderSequence.length - 1)
    ];
    stockLogsByOrderCursor += 1;
    return staged ?? options.stockLogsByOrder;
  };

  let currentUsers: readonly unknown[] = options.usersList?.users ?? [];

  const bridge = {
    apiVersion: '0.3.0',
    getAppStatus: async (): Promise<unknown> => {
      record('getAppStatus');
      return statusPayload();
    },
    auth: {
      getState: async (): Promise<unknown> => {
        record('auth.getState');
        if (options.throwOnGetState === true) {
          throw new Error('state unavailable');
        }
        return currentState;
      },
      signIn: async (credentials: unknown): Promise<unknown> => {
        record('auth.signIn', credentials);
        if (options.throwOnSignIn === true) {
          throw new Error('sign-in transport failed');
        }
        if (options.signInResult !== undefined) {
          if (options.signInResult.success) {
            currentState = afterSignIn;
          }
          return options.signInResult;
        }
        currentState = afterSignIn;
        return { success: true, authState: afterSignIn };
      },
      signOut: async (): Promise<void> => {
        record('auth.signOut');
        if (options.throwOnSignOut === true) {
          throw new Error('sign-out failed');
        }
        currentState = SIGNED_OUT;
      },
    },
    // Stage 9: the two named user operations. The harness models the server by
    // MUTATING `currentUsers`, so a test can prove the renderer re-read what was
    // actually stored rather than patching its own copy.
    users: {
      list: async (): Promise<unknown> => {
        record('users.list');
        if (options.throwOnUsersList === true) {
          throw new Error('users list transport failed');
        }
        if (options.usersList !== undefined && options.usersList.ok === false) {
          return {
            ok: false,
            error: options.usersList.error ?? { code: 'INTERNAL_ERROR', message: 'خطأ', retryable: false },
          };
        }
        return { ok: true, value: currentUsers };
      },
      update: async (input: unknown): Promise<unknown> => {
        record('users.update', input);
        if (options.throwOnUsersUpdate === true) {
          throw new Error('users update transport failed');
        }
        if (options.usersUpdate !== undefined && options.usersUpdate.ok === false) {
          return {
            ok: false,
            error: options.usersUpdate.error ?? { code: 'INTERNAL_ERROR', message: 'خطأ', retryable: false },
          };
        }
        applyServerSideUpdate(input as Record<string, unknown>);
        options.onUsersUpdate?.(input as Record<string, unknown>);
        return { ok: true, value: null };
      },
    },
    // Stage 10: the catalogue read and the SINGLE writable field. The harness
    // mutates its collection on success so a test can prove the renderer re-reads
    // what the server stored - and, crucially, that the OTHER fields are
    // untouched, which is what the update mask guarantees on a real Firestore.
    medicines: {
      list: async (): Promise<unknown> => {
        record('medicines.list');
        if (options.throwOnMedicinesList === true) {
          throw new Error('medicines list transport failed');
        }
        if (options.medicinesList !== undefined && options.medicinesList.ok === false) {
          return {
            ok: false,
            error: options.medicinesList.error ?? { code: 'INTERNAL_ERROR', message: 'خطأ', retryable: false },
          };
        }
        return { ok: true, value: currentMedicines };
      },
      updateMaxQuantity: async (input: unknown): Promise<unknown> => {
        record('medicines.updateMaxQuantity', input);
        if (options.throwOnMedicinesUpdate === true) {
          throw new Error('medicines update transport failed');
        }
        if (options.medicinesUpdate !== undefined && options.medicinesUpdate.ok === false) {
          return {
            ok: false,
            error: options.medicinesUpdate.error ?? { code: 'INTERNAL_ERROR', message: 'خطأ', retryable: false },
          };
        }
        const payload = input as Record<string, unknown>;
        const id = payload['medicineId'];
        if (typeof id === 'string' && typeof payload['maxQuantity'] === 'number') {
          currentMedicines = currentMedicines.map((entry) => {
            const medicine = entry as Record<string, unknown>;
            // ONLY maxQuantity changes; every other field is copied through,
            // exactly as an explicit update mask behaves on Firestore.
            return medicine['id'] === id ? { ...medicine, maxQuantity: payload['maxQuantity'] } : entry;
          });
        }
        return { ok: true, value: null };
      },
    },
    // Stage 11: the request queue. `get` is the AUTHORITATIVE single read, so a
    // test can prove the renderer re-reads after a write; `orders.process` hands
    // back whatever outcome the test staged, including the three that mean very
    // different things. The harness mutates the collection ONLY where a real
    // Stage 6 run would have written, so a test cannot accidentally assert a
    // success the real engine would not have produced.
    orderRequests: {
      list: async (): Promise<unknown> => {
        record('orderRequests.list');
        if (options.throwOnOrderRequestsList === true) {
          throw new Error('order requests list transport failed');
        }
        if (options.orderRequestsList !== undefined && options.orderRequestsList.ok === false) {
          return {
            ok: false,
            error: options.orderRequestsList.error ?? { code: 'INTERNAL_ERROR', message: 'خطأ', retryable: false },
          };
        }
        return { ok: true, value: currentOrders };
      },
      get: async (input: unknown): Promise<unknown> => {
        record('orderRequests.get', input);
        const getIndex = orderRequestsGetSequenceIndex;
        orderRequestsGetSequenceIndex += 1;
        await options.orderRequestsGetGates?.[getIndex];
        if (options.throwOnOrderRequestsGet === true) {
          throw new Error('order request get transport failed');
        }
        const sequenceAnswer = options.orderRequestsGetSequence?.[getIndex];
        if (sequenceAnswer !== undefined) {
          if (!sequenceAnswer.ok) {
            return {
              ok: false,
              error: sequenceAnswer.error ?? { code: 'INTERNAL_ERROR', message: 'خطأ', retryable: false },
            };
          }
          if (sequenceAnswer.order !== undefined) {
            return { ok: true, value: sequenceAnswer.order };
          }
        }
        const requestId = (input as Record<string, unknown> | undefined)?.['requestId'];
        if (options.orderRequestsGet !== undefined) {
          if (options.orderRequestsGet.ok === false) {
            return {
              ok: false,
              error: options.orderRequestsGet.error ?? { code: 'INTERNAL_ERROR', message: 'خطأ', retryable: false },
            };
          }
          if (options.orderRequestsGet.order !== undefined) {
            return { ok: true, value: options.orderRequestsGet.order };
          }
        }
        const found = currentOrders.find((entry) => (entry as Record<string, unknown>)['id'] === requestId);
        return found === undefined
          ? { ok: false, error: { code: 'NOT_FOUND', message: 'غير موجود', retryable: false } }
          : { ok: true, value: found };
      },
      submit: async (input: unknown): Promise<unknown> => {
        record('orderRequests.submit', input);
        if (options.throwOnOrderRequestSubmit === true) {
          throw new Error('order request submission transport failed');
        }
        await options.orderRequestSubmitGate;
        const answer = options.orderRequestSubmit;
        if (answer !== undefined && answer.ok === false) {
          return {
            ok: false,
            error: answer.error ?? { code: 'AUTHORIZATION_DENIED', message: 'غير مصرح', retryable: false },
          };
        }
        return { ok: true, value: { requestId: answer?.requestId ?? 'request-created-1' } };
      },
    },
    // Stage 13: the settings read. Argument-free, exactly like the real bridge.
    settings: {
      get: async (): Promise<unknown> => {
        const answer = nextSettingsAnswer();
        record('settings.get');
        if (options.throwOnSettingsGet === true) {
          throw new Error('settings get transport failed');
        }
        if (answer !== undefined && answer.ok === false) {
          return {
            ok: false,
            error: answer.error ?? { code: 'INTERNAL_ERROR', message: 'x', retryable: false },
          };
        }
        return { ok: true, value: answer?.settings ?? null };
      },
    },
    // Stage 14: the READ-ONLY movement audit read. Argument-free, exactly like the
    // real bridge, and there is NO write method beside it - so a test could not
    // drive a stock movement through this fake even if the page exposed a control.
    stockLogs: {
      list: async (): Promise<unknown> => {
        const answer = nextStockLogsAnswer();
        record('stockLogs.list');
        if (options.throwOnStockLogsList === true) {
          throw new Error('stock logs list transport failed');
        }
        if (answer !== undefined && answer.ok === false) {
          return {
            ok: false,
            error: answer.error ?? { code: 'INTERNAL_ERROR', message: 'خطأ', retryable: false },
          };
        }
        return { ok: true, value: answer?.movements ?? [] };
      },
      listByOrder: async (input: unknown): Promise<unknown> => {
        record('stockLogs.listByOrder', input);
        if (options.stockLogsByOrderGate !== undefined) {
          await options.stockLogsByOrderGate;
        }
        if (options.throwOnStockLogsByOrder === true) {
          throw new Error('stock logs by order transport failed');
        }
        const answer = nextStockLogsByOrderAnswer();
        if (answer !== undefined && answer.ok === false) {
          return {
            ok: false,
            error: answer.error ?? { code: 'INTERNAL_ERROR', message: 'خطأ', retryable: false },
          };
        }
        return { ok: true, value: answer?.movements ?? [] };
      },
    },
    orders: {
      // Stage 12: the READ-ONLY history read. It takes no argument, exactly as the
      // real bridge does, and the recorded call therefore always has an empty
      // `args` - which is what lets a test assert the renderer supplied nothing.
      list: async (): Promise<unknown> => {
        record('orders.list');
        const requestIndex = ordersListCursor;
        const answer = nextOrdersListAnswer();
        await (options.ordersListGateSequence?.[requestIndex] ?? options.ordersListGate);
        if (options.throwOnOrdersList === true) {
          throw new Error('orders list transport failed');
        }
        if (answer !== undefined && answer.ok === false) {
          return {
            ok: false,
            error: answer.error ?? { code: 'INTERNAL_ERROR', message: 'خطأ', retryable: false },
          };
        }
        return {
          ok: true,
          value: {
            orders: answer?.orders ?? [],
            hasMore: answer?.hasMore ?? false,
          },
        };
      },
      loadMore: async (): Promise<unknown> => {
        record('orders.loadMore');
        const requestIndex = ordersLoadMoreCursor;
        const answer = nextOrdersLoadMoreAnswer();
        await (options.ordersLoadMoreGateSequence?.[requestIndex] ?? options.ordersLoadMoreGate);
        if (options.throwOnOrdersLoadMore === true) {
          throw new Error('orders load more transport failed');
        }
        if (answer !== undefined && answer.ok === false) {
          return {
            ok: false,
            error: answer.error ?? { code: 'INTERNAL_ERROR', message: 'خطأ', retryable: false },
          };
        }
        return {
          ok: true,
          value: {
            orders: answer?.orders ?? [],
            hasMore: answer?.hasMore ?? false,
          },
        };
      },
      myHistory: async (): Promise<unknown> => {
        record('orders.myHistory');
        if (options.throwOnOrdersMyHistory === true) {
          throw new Error('personal orders history transport failed');
        }
        await options.ordersMyHistoryGate;
        if (options.ordersMyHistory !== undefined && options.ordersMyHistory.ok === false) {
          return {
            ok: false,
            error: options.ordersMyHistory.error ?? { code: 'INTERNAL_ERROR', message: 'خطأ', retryable: false },
          };
        }
        return { ok: true, value: options.ordersMyHistory?.orders ?? [] };
      },
      process: async (input: unknown): Promise<unknown> => {
        record('orders.process', input);
        if (options.throwOnOrdersProcess === true) {
          throw new Error('orders process transport failed');
        }
        if (options.ordersProcess !== undefined && options.ordersProcess.ok === false) {
          return {
            ok: false,
            error: options.ordersProcess.error ?? { code: 'INTERNAL_ERROR', message: 'خطأ', retryable: false },
          };
        }
        const requestId = (input as Record<string, unknown> | undefined)?.['requestId'];
        const staged = options.ordersProcess?.outcome;
        if (staged !== undefined && staged !== null) {
          // A staged outcome still describes a real transaction, so the fake
          // collection has to end up agreeing with it. Returning the staged value
          // while leaving the stored document untouched would make the NEXT
          // refresh contradict the outcome the test just staged.
          applyStagedProcessing(requestId, staged as Record<string, unknown>);
          return { ok: true, value: staged };
        }
        // Default: a genuine Stage 6 success. W1-W5 committed, so the stored
        // document really does change - status, orderId and processedAt - and the
        // inventory figures stay untouched because Stage 6 wrote absolute values.
        const now = '2026-06-04T09:00:00.000Z';
        const orderId = 'order-generated-1';
        currentOrders = currentOrders.map((entry) => {
          const order = entry as Record<string, unknown>;
          return order['id'] === requestId
            ? { ...order, status: 'processed', orderId, processedBy: 'uid-admin', processedAtIso: now, error: null }
            : entry;
        });
        return { ok: true, value: { outcome: 'processed', orderId, reason: null, status: null } };
      },
    },
  };

  let currentMedicines: readonly unknown[] = options.medicinesList?.medicines ?? [];
  let currentOrders: readonly unknown[] = options.orderRequestsList?.orders ?? [];
  let orderRequestsGetSequenceIndex = 0;

  /**
   * Applies to the fake collection what a STAGED outcome actually wrote.
   *
   * The rule is taken from the OUTCOME KIND, never from a literal a test chose,
   * because the two are different things and conflating them is how a harness
   * ends up asserting fiction:
   *
   *   `processed`   - W1-W5 committed, so the document moves to `processed` and
   *                   carries the order id the engine reported.
   *   `rejected`    - a business refusal that STILL COMMITTED the `failed`
   *                   marker (Stage 6 A2). The document moves to `failed` and
   *                   stores the engine's own reason. This is the transition
   *                   most often mis-staged as "nothing happened".
   *   `already-processed` - the engine wrote NOTHING. The document is left
   *                   exactly as it is, because there is no state change to
   *                   reflect; only the reported `status` is carried.
   *
   * A failed envelope and a thrown transport error never reach here at all: they
   * return before this is called, which is what makes "a failure must not mutate
   * the collection" true by construction rather than by assertion.
   */
  function applyStagedProcessing(requestId: unknown, outcome: Record<string, unknown>): void {
    if (typeof requestId !== 'string' || requestId.length === 0) {
      return;
    }
    const kind = outcome['outcome'];
    currentOrders = currentOrders.map((entry) => {
      const order = entry as Record<string, unknown>;
      if (order['id'] !== requestId) {
        return entry;
      }
      if (kind === 'processed') {
        return {
          ...order,
          status: 'processed',
          orderId: outcome['orderId'] ?? null,
          processedBy: 'uid-admin',
          processedAtIso: '2026-06-04T09:00:00.000Z',
          error: null,
        };
      }
      if (kind === 'rejected') {
        // The `failed` marker is a COMMITTED write, so the reason is stored on
        // the document rather than only returned in the envelope.
        return {
          ...order,
          status: 'failed',
          orderId: null,
          processedBy: 'uid-admin',
          processedAtIso: '2026-06-04T09:00:00.000Z',
          error: outcome['reason'] ?? null,
        };
      }
      // `already-processed`, and anything unrecognised: NO write happened, so
      // the stored document must not be invented into a new state.
      return entry;
    });
  }

  /** The stored document for one request, exactly as the fake collection holds it. */
  function fakeOrderFor(requestId: string): Record<string, unknown> | null {
    const found = currentOrders.find((entry) => (entry as Record<string, unknown>)['id'] === requestId);
    return (found as Record<string, unknown> | undefined) ?? null;
  }

  /**
   * Applies a permitted transition to the fake collection, so the subsequent
   * `list()` reflects a genuinely changed document - including the `lastOrder*`
   * fields, which a real masked write leaves untouched.
   */
  function applyServerSideUpdate(payload: Record<string, unknown>): void {
    const uid = payload['uid'];
    if (typeof uid !== 'string') {
      return;
    }
    currentUsers = currentUsers.map((entry) => {
      const user = entry as Record<string, unknown>;
      if (user['uid'] !== uid) {
        return entry;
      }
      const next: Record<string, unknown> = { ...user };
      if (typeof payload['name'] === 'string') {
        next['name'] = payload['name'];
      }
      if (payload['approval'] === 'approve') {
        next['status'] = 'approved';
      } else if (payload['approval'] === 'reject') {
        next['status'] = 'rejected';
      }
      if (payload['exception'] === 'grant') {
        next['hasException'] = true;
      } else if (payload['exception'] === 'revoke') {
        next['hasException'] = false;
      }
      return next;
    });
  }

  let printCallCount = 0;
  const windowStub = {
    drugManager: bridge,
    print: (): void => {
      printCallCount += 1;
    },
  } as unknown as Record<string, unknown>;
  const sandbox: Record<string, unknown> = {
    document,
    window: windowStub,
    console,
  };

  const bundle = readFileSync(join(projectRoot, 'dist', 'renderer', 'renderer.js'), 'utf8');
  runInNewContext(bundle, sandbox, { filename: 'renderer.js' });

  // The script defers its start-up to DOMContentLoaded, exactly as it does in
  // the browser, so the harness fires the same event.
  document.dispatchEvent(new FakeEvent('DOMContentLoaded'));
  await settle();

  const element = (id: string): FakeElement => {
    const found = document.getElementById(id);
    if (found === null) {
      throw new Error(`the shipped markup does not declare id="${id}"`);
    }
    return found;
  };

  return {
    document,
    calls,
    element,
    uiState: (): string => document.body.dataset['uiState'] ?? '',
    visibleView: (): 'login' | 'shell' => (element('shell-view').hidden ? 'login' : 'shell'),
    callsTo: (name: string): readonly ApiCall[] => calls.filter((call) => call.name === name),
    submitLogin: async (email: string, password: string): Promise<void> => {
      (element('login-email') as unknown as { value: string }).value = email;
      (element('login-password') as unknown as { value: string }).value = password;
      element('login-form').dispatchEvent(new FakeEvent('submit'));
      await settle();
    },
    clickLogout: async (): Promise<void> => {
      element('logout-button').dispatchEvent(new FakeEvent('click'));
      await settle();
    },
    clickPasswordToggle: (): void => {
      element('password-toggle').dispatchEvent(new FakeEvent('click'));
    },
    clickNav: (view: string): void => {
      const button = document.querySelectorAll('[data-view]')
        .find((candidate) => candidate.getAttribute('data-view') === view);
      if (button === undefined) {
        throw new Error(`the shipped markup has no navigation entry for "${view}"`);
      }
      button.dispatchEvent(new FakeEvent('click'));
    },
    openUsers: async (): Promise<void> => {
      const button = document.querySelectorAll('[data-view]')
        .find((candidate) => candidate.getAttribute('data-view') === 'users');
      if (button === undefined) {
        throw new Error('the shipped markup has no navigation entry for "users"');
      }
      button.dispatchEvent(new FakeEvent('click'));
      await settle();
    },
    searchUsers: (term: string): void => {
      const input = element('users-search-input');
      input.value = term;
      input.dispatchEvent(new FakeEvent('input'));
    },
    clickRefresh: async (): Promise<void> => {
      element('users-refresh').dispatchEvent(new FakeEvent('click'));
      await settle();
    },
    userRows: (): readonly FakeElement[] => element('users-rows').children,
    rowCells: (row: FakeElement): readonly string[] => row.children.map((cell) => cell.textContent),
    openUserDialog: (uid: string): void => {
      const open = element('users-rows').children
        .flatMap((row) => row.querySelectorAll('button'))
        .find((button) => button.getAttribute('data-uid') === uid);
      if (open === undefined) {
        throw new Error(`no details button for uid "${uid}"`);
      }
      open.dispatchEvent(new FakeEvent('click'));
    },
    userDialogOpen: (): boolean => element('user-dialog').dialogOpen,
    typeUserName: (value: string): void => {
      (element('user-detail-name') as unknown as { value: string }).value = value;
    },
    clickUserAction: async (action: 'save' | 'approve' | 'reject' | 'grant' | 'revoke'): Promise<void> => {
      const ids = {
        save: 'user-save',
        approve: 'user-approve',
        reject: 'user-reject',
        grant: 'user-grant-exception',
        revoke: 'user-revoke-exception',
      } as const;
      element(ids[action]).dispatchEvent(new FakeEvent('click'));
      await settle();
    },
    userDialogError: (): string | null => {
      const region = element('user-dialog-error');
      return region.hidden ? null : element('user-dialog-error-message').textContent;
    },
    usersViewState: (): string => element('users-state').getAttribute('data-view-state') ?? '',

    // ---- Stage 10: the medicines module ----
    openMedicines: async (): Promise<void> => {
      const button = document.querySelectorAll('[data-view]')
        .find((candidate) => candidate.getAttribute('data-view') === 'medicines');
      if (button === undefined) {
        throw new Error('the shipped markup has no navigation entry for "medicines"');
      }
      button.dispatchEvent(new FakeEvent('click'));
      await settle();
    },
    searchMedicines: (term: string): void => {
      const input = element('medicines-search-input');
      input.value = term;
      input.dispatchEvent(new FakeEvent('input'));
    },
    clickMedicinesRefresh: async (): Promise<void> => {
      element('medicines-refresh').dispatchEvent(new FakeEvent('click'));
      await settle();
    },
    medicineRows: (): readonly FakeElement[] => element('medicines-rows').children,
    medicineRowCells: (row: FakeElement): readonly string[] => row.children.map((cell) => cell.textContent),
    openMedicineDialog: (medicineId: string): void => {
      const open = element('medicines-rows').children
        .flatMap((row) => row.querySelectorAll('button'))
        .find((button) => button.getAttribute('data-medicine-id') === medicineId);
      if (open === undefined) {
        throw new Error(`no details button for medicine "${medicineId}"`);
      }
      open.dispatchEvent(new FakeEvent('click'));
    },
    medicineDialogOpen: (): boolean => element('medicine-dialog').dialogOpen,
    typeMaxQuantity: (value: string): void => {
      (element('medicine-detail-max-quantity') as unknown as { value: string }).value = value;
    },
    clickMedicineSave: async (): Promise<void> => {
      element('medicine-save').dispatchEvent(new FakeEvent('click'));
      await settle();
    },
    medicineDialogError: (): string | null => {
      const region = element('medicine-dialog-error');
      return region.hidden ? null : element('medicine-dialog-error-message').textContent;
    },
    medicinesViewState: (): string => element('medicines-state').getAttribute('data-view-state') ?? '',

    // ---- Stage 11: the order-requests module ----
    openOrders: async (): Promise<void> => {
      const button = document.querySelectorAll('[data-view]')
        .find((candidate) => candidate.getAttribute('data-view') === 'orders');
      if (button === undefined) {
        throw new Error('the shipped markup has no navigation entry for "orders"');
      }
      button.dispatchEvent(new FakeEvent('click'));
      await settle();
    },
    searchOrders: (term: string): void => {
      const input = element('orders-search-input');
      input.value = term;
      input.dispatchEvent(new FakeEvent('input'));
    },
    filterOrdersByStatus: (value: string): void => {
      const select = element('orders-status-filter');
      select.value = value;
      select.dispatchEvent(new FakeEvent('change'));
    },
    clickOrdersRefresh: async (): Promise<void> => {
      element('orders-refresh').dispatchEvent(new FakeEvent('click'));
      await settle();
    },
    orderRows: (): readonly FakeElement[] => element('orders-rows').children,
    orderRowCells: (row: FakeElement): readonly string[] => row.children.map((cell) => cell.textContent),
    openOrderDialog: (requestId: string): void => {
      const open = element('orders-rows').children
        .flatMap((row) => row.querySelectorAll('button'))
        .find((button) => button.getAttribute('data-request-id') === requestId);
      if (open === undefined) {
        throw new Error(`no details button for request "${requestId}"`);
      }
      open.dispatchEvent(new FakeEvent('click'));
    },
    orderDialogOpen: (): boolean => element('order-dialog').dialogOpen,
    orderDetailEmployee: (): string => element('order-detail-employee').textContent,
    orderDetailStatus: (): string => element('order-detail-status').textContent,
    orderDetailOrderId: (): string => element('order-detail-order-id').textContent,
    orderDetailItems: (): readonly string[][] => element('order-detail-items').children
      .map((row) => row.children.map((cell) => cell.textContent)),
    orderConfirmOpen: (): boolean => element('order-confirm-dialog').dialogOpen,
    clickProcessOrder: async (): Promise<void> => {
      element('order-process').dispatchEvent(new FakeEvent('click'));
      await settle();
    },
    clickConfirmOrder: async (): Promise<void> => {
      element('order-confirm-accept').dispatchEvent(new FakeEvent('click'));
      await settle();
    },
    orderDialogError: (): string | null => {
      const region = element('order-dialog-error');
      return region.hidden ? null : element('order-dialog-error-message').textContent;
    },
    orderOutcomeMessage: (): string | null => {
      const region = element('order-outcome-message');
      return region.hidden ? null : region.textContent;
    },
    ordersViewState: (): string => element('orders-state').getAttribute('data-view-state') ?? '',
    // ---- Stage 16: the employee request submission view ----
    openRequestSubmission: async (): Promise<void> => {
      const button = document.querySelectorAll('[data-view]')
        .find((candidate) => candidate.getAttribute('data-view') === 'request-submit');
      if (button === undefined) {
        throw new Error('the shipped markup has no request-submission navigation button');
      }
      button.dispatchEvent(new FakeEvent('click'));
      await settle();
    },
    chooseRequestMedicine: (medicineId: string): void => {
      element('request-medicine-select').value = medicineId;
    },
    typeRequestQuantity: (value: string): void => {
      element('request-quantity').value = value;
    },
    addRequestItem: (): void => {
      element('request-add-item').dispatchEvent(new FakeEvent('click'));
    },
    clickRequestSubmit: async (): Promise<void> => {
      element('request-submit').dispatchEvent(new FakeEvent('click'));
      await settle();
    },
    requestItems: (): readonly string[][] => element('request-items').children
      .map((row) => row.children.map((cell) => cell.textContent)),
    requestSubmitState: (): string => element('request-submit-state').getAttribute('data-view-state') ?? '',
    requestSubmitMessage: (): string => element('request-submit-state-message').textContent,
    clickRequestStatusRefresh: async (): Promise<void> => {
      element('request-status-refresh').dispatchEvent(new FakeEvent('click'));
      await settle();
    },
    requestStatusState: (): string => element('request-status-panel').getAttribute('data-view-state') ?? '',
    requestStatusRequestId: (): string => element('request-status-request-id').textContent,
    requestStatusMessage: (): string => element('request-status-message').textContent,
    // ---- Stage 12: the read-only orders-history module ----
    openOrdersHistory: async (): Promise<void> => {
      const button = document.querySelectorAll('[data-view]')
        .find((candidate) => candidate.getAttribute('data-view') === 'orders-history');
      if (button === undefined) {
        throw new Error('the shipped markup has no navigation entry for "orders-history"');
      }
      button.dispatchEvent(new FakeEvent('click'));
      await settle();
    },
    searchOrdersHistory: (term: string): void => {
      const input = element('orders-history-search-input');
      input.value = term;
      input.dispatchEvent(new FakeEvent('input'));
    },
    filterOrdersHistoryByStatus: (value: string): void => {
      const select = element('orders-history-status-filter');
      select.value = value;
      select.dispatchEvent(new FakeEvent('change'));
    },
    clickOrdersHistoryRefresh: async (): Promise<void> => {
      element('orders-history-refresh').dispatchEvent(new FakeEvent('click'));
      await settle();
    },
    clickOrdersHistoryLoadMore: async (): Promise<void> => {
      element('orders-history-load-more').dispatchEvent(new FakeEvent('click'));
      await settle();
    },
    clickOrdersHistoryPrint: (): void => {
      element('orders-history-print').dispatchEvent(new FakeEvent('click'));
    },
    orderHistoryRows: (): readonly FakeElement[] => element('orders-history-rows').children,
    orderHistoryRowCells: (row: FakeElement): readonly string[] => row.children.map((cell) => cell.textContent),
    ordersHistoryViewState: (): string => element('orders-history-state').getAttribute('data-view-state') ?? '',
    ordersHistoryError: (): string | null => {
      const region = element('orders-history-state');
      if (region.getAttribute('data-view-state') !== 'error') {
        return null;
      }
      return element('orders-history-state-message').textContent;
    },
    ordersHistoryCount: (): string => element('orders-history-count').textContent,
    openOrderHistoryDialog: (orderId: string): void => {
      const open = element('orders-history-rows').children
        .flatMap((row) => row.querySelectorAll('button'))
        .find((button) => button.getAttribute('data-order-id') === orderId);
      if (open === undefined) {
        throw new Error(`no details button for order "${orderId}"`);
      }
      open.dispatchEvent(new FakeEvent('click'));
    },
    orderHistoryDialogOpen: (): boolean => element('order-history-dialog').dialogOpen,
    closeOrderHistoryDialog: (): void => {
      element('order-history-dialog-close').dispatchEvent(new FakeEvent('click'));
    },
    orderHistoryDetails: (): Record<string, string> => ({
      id: element('order-history-detail-id').textContent,
      employee: element('order-history-detail-employee').textContent,
      date: element('order-history-detail-date').textContent,
      month: element('order-history-detail-month').textContent,
      status: element('order-history-detail-status').textContent,
      exception: element('order-history-detail-exception').textContent,
      request: element('order-history-detail-request').textContent,
    }),
    orderHistoryDetailItems: (): readonly string[][] => element('order-history-detail-items').children
      .map((row) => row.children.map((cell) => cell.textContent)),
    orderHistoryMovementsState: (): string =>
      element('order-history-movements-state').getAttribute('data-view-state') ?? '',
    orderHistoryMovementsError: (): string | null => {
      if (element('order-history-movements-state').getAttribute('data-view-state') !== 'error') {
        return null;
      }
      return element('order-history-movements-state-message').textContent;
    },
    orderHistoryMovementRows: (): readonly FakeElement[] =>
      element('order-history-movements-rows').children,

    /**
     * Every control the SHIPPED markup gives to the history panel and its dialog,
     * as `[id, tagName]`.
     *
     * Read from `index.html` rather than the fake tree, because that tree is
     * deliberately FLAT - it registers only the elements carrying an id - so a walk of
     * its `children` would report nothing and prove nothing.
     *
     * Reading the markup is also the stronger check: a write control must exist in
     * the shipped page to be clickable by a user at all, and this cannot be
     * satisfied by anything existing only in a test or only in the bundle.
     */
    orderHistoryControls: (): readonly (readonly [string, string])[] =>
      buildOrderHistoryControls(),

    orderHistoryButtonsInMarkup: (): readonly string[] =>
      buildOrderHistoryControls().map(([id]) => id),
    // ---- Stage 17: the read-only personal order history ----
    openMyOrderHistory: async (): Promise<void> => {
      const button = document.querySelectorAll('[data-view]')
        .find((candidate) => candidate.getAttribute('data-view') === 'my-orders');
      if (button === undefined) {
        throw new Error('the shipped markup has no personal order-history navigation button');
      }
      button.dispatchEvent(new FakeEvent('click'));
      await settle();
    },
    clickMyOrderHistoryRefresh: async (): Promise<void> => {
      element('my-orders-refresh').dispatchEvent(new FakeEvent('click'));
      await settle();
    },
    clickMyOrderHistoryPrint: (): void => {
      element('my-orders-print').dispatchEvent(new FakeEvent('click'));
    },
    printCalls: (): number => printCallCount,
    searchMyOrderHistory: (term: string): void => {
      const input = element('my-orders-search-input');
      input.value = term;
      input.dispatchEvent(new FakeEvent('input'));
    },
    filterMyOrderHistoryByStatus: (value: string): void => {
      const select = element('my-orders-status-filter');
      select.value = value;
      select.dispatchEvent(new FakeEvent('change'));
    },
    clearMyOrderHistoryFilters: (): void => {
      const button = element('my-orders-clear-filters');
      button.dispatchEvent(new FakeEvent('click'));
    },
    myOrderHistoryRows: (): readonly FakeElement[] => element('my-orders-rows').children,
    myOrderHistoryRowCells: (row: FakeElement): readonly string[] => row.children.map((cell) => cell.textContent),
    myOrderHistoryViewState: (): string => element('my-orders-state').getAttribute('data-view-state') ?? '',
    myOrderHistoryError: (): string | null => {
      if (element('my-orders-state').getAttribute('data-view-state') !== 'error') {
        return null;
      }
      return element('my-orders-state-message').textContent;
    },
    myOrderHistoryCount: (): string => element('my-orders-count').textContent,
    /** Stage 13: opens the read-only settings page and settles. */
    openSettings: async (): Promise<void> => {
      const button = document.querySelectorAll('[data-view]')
        .find((candidate) => candidate.getAttribute('data-view') === 'settings');
      if (button === undefined) {
        throw new Error('the shipped markup has no settings navigation button');
      }
      button.dispatchEvent(new FakeEvent('click'));
      button.dispatchEvent(new FakeEvent('click'));
      await settle();
    },
    /** Clicks the settings refresh control and settles. */
    clickSettingsRefresh: async (): Promise<void> => {
      element('settings-refresh').dispatchEvent(new FakeEvent('click'));
      await settle();
    },
    /** Clicks the settings retry control and settles. */
    clickSettingsRetry: async (): Promise<void> => {
      const button = element('settings-retry');
      // The retry button is hidden unless the last read FAILED, and a hidden
      // button is not a thing a user can click. The fake DOM would happily
      // dispatch to it, so the guard is here: without it a test could "offer a
      // retry" on a page that is showing perfectly good values, and the extra
      // read it triggers would look like the product misbehaving.
      if (button.hidden) {
        throw new Error('the retry button is hidden, so it cannot be clicked');
      }
      button.dispatchEvent(new FakeEvent('click'));
      await settle();
    },
    settingsViewState: (): string => element('settings-state').getAttribute('data-view-state') ?? '',
    settingsError: (): string | null => {
      const message = element('settings-state-message').textContent;
      return message === '' ? null : message;
    },
    /** Every displayed value, keyed by the element it was printed into. */
    settingsValues: (): Readonly<Record<string, string>> => ({
      minDays: element('settings-min-days').textContent,
      friday: element('settings-friday').textContent,
      startTime: element('settings-start-time').textContent,
      endTime: element('settings-end-time').textContent,
      maxDaily: element('settings-max-daily').textContent,
      assistant: element('settings-assistant').textContent,
    }),
    /** Whether the "not configured" advisory banner is on screen. */
    settingsNotConfiguredVisible: (): boolean => !element('settings-not-configured').hidden,
    /**
     * The shipped `settings-view` section, read as text with no DOM involved.
     *
     * HTML comments are stripped before the text is returned. The panel's own
     * comment explains WHY there is no form, and a checker that read the raw
     * text would trip over that explanation and report a form that the browser
     * never sees. What a browser renders is what a reader of this string must
     * be able to check, so the comments go.
     */
    settingsMarkup: (): string => {
      return stripHtmlComments(readSettingsPanelHtml());
    },
    /** Every control id the shipped settings panel carries. */
    settingsControlsInMarkup: (): readonly string[] => {
      const section = stripHtmlComments(readSettingsPanelHtml());
      const start = section.indexOf('<section class="panel" id="settings-view"');
      const scope = section.slice(start, section.indexOf('</section>', start));
      const ids: string[] = [];
      for (const match of scope.matchAll(/<(?:button|input|select|textarea)\b[^>]*\bid="([^"]+)"/g)) {
        ids.push(match[1] ?? '');
      }
      return ids;
    },

    // ---- Stage 14: the READ-ONLY stock movement audit page ----

    /** Opens the movement page and settles the load it triggers. */
    openStockMovements: async (): Promise<void> => {
      const button = document.querySelectorAll('[data-view]')
        .find((candidate) => candidate.getAttribute('data-view') === 'stock');
      if (button === undefined) {
        throw new Error('the shipped markup has no stock movement navigation button');
      }
      button.dispatchEvent(new FakeEvent('click'));
      await settle();
    },
    /** Clicks the movement refresh control and settles. */
    clickStockRefresh: async (): Promise<void> => {
      element('stock-refresh').dispatchEvent(new FakeEvent('click'));
      await settle();
    },
    /** Clicks the movement retry control and settles. */
    clickStockRetry: async (): Promise<void> => {
      element('stock-retry').dispatchEvent(new FakeEvent('click'));
      await settle();
    },
    /**
     * Types into the movement search box.
     *
     * Deliberately settles NOTHING: the search is a local filter, so a test can
     * assert that no request was recorded while the rows changed.
     */
    searchStockMovements: (term: string): void => {
      const input = element('stock-search-input');
      input.value = term;
      input.dispatchEvent(new FakeEvent('input'));
    },
    /** Chooses a direction in the movement filter; sends no request. */
    filterStockMovementsByDirection: (value: string): void => {
      const select = element('stock-direction-filter');
      select.value = value;
      select.dispatchEvent(new FakeEvent('change'));
    },
    stockRows: (): readonly FakeElement[] => element('stock-rows').children,
    stockRowCells: (row: FakeElement): readonly string[] => row.children.map((cell) => cell.textContent),
    stockViewState: (): string => element('stock-state').getAttribute('data-view-state') ?? '',
    stockError: (): string | null => {
      if (element('stock-state').getAttribute('data-view-state') !== 'error') {
        return null;
      }
      return element('stock-state-message').textContent;
    },
    stockCount: (): string => element('stock-count').textContent,
    /**
     * The shipped `stock-view` panel as text.
     *
     * HTML comments are stripped first: the panel documents WHY it has no totals
     * inside a comment, and a text check that read that note as a violation would
     * be reporting the explanation instead of the code.
     */
    stockMarkup: (): string => stripHtmlComments(readStockPanelHtml()),
    /**
     * Every control inside the movement panel, as `id -> tagName`.
     *
     * Read out of the LIVE DOM rather than the source, so a control the renderer
     * creates dynamically would appear here - which is precisely the sort of
     * invisible write control this list exists to expose.
     */
    stockControls: (): readonly (readonly [string, string])[] => buildStockControls(),
    /** Every control id the SHIPPED `index.html` gives the movement panel. */
    stockButtonsInMarkup: (): readonly string[] => {
      const section = stripHtmlComments(readStockPanelHtml());
      const start = section.indexOf('<section class="panel" id="stock-view"');
      const scope = section.slice(start, section.indexOf('</section>', start));
      const ids: string[] = [];
      for (const match of scope.matchAll(/<(?:button|input|select|textarea)\b[^>]*\bid="([^"]+)"/g)) {
        ids.push(match[1] ?? '');
      }
      return ids;
    },
    /**
     * The stored document for one request, as the fake collection holds it.
     *
     * Exposed so a test can assert what the SERVER ended up with, separately
     * from what the renderer chose to display. Keeping the two apart is what
     * makes "the row moved because the document moved" distinguishable from
     * "the row moved because the renderer guessed".
     */
    storedOrder: (requestId: string): Record<string, unknown> | null => fakeOrderFor(requestId),
    settle,
  };
}
