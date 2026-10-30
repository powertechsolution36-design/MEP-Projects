'use strict';

/**
 * Barrel export for all 15 DATABASE_SCHEMA.md collections plus internal
 * plumbing collections (`counters`, `authSessions`). No route/controller/
 * service imported from here until the corresponding module was actually
 * authorized: Counter was added for the database-schema task; AuthSession
 * was added for the authentication-foundation task. Neither is one of the
 * 15 approved business collections, and neither modifies them.
 */

module.exports = {
  Company: require('./Company'),
  User: require('./User'),
  Enquiry: require('./Enquiry'),
  SalesOrder: require('./SalesOrder'),
  Project: require('./Project'),
  ServiceCall: require('./ServiceCall'),
  Contract: require('./Contract'),
  Payment: require('./Payment'),
  Notification: require('./Notification'),
  ChecklistTemplate: require('./ChecklistTemplate'),
  InventoryCategory: require('./InventoryCategory'),
  InventoryLocation: require('./InventoryLocation'),
  InventoryItem: require('./InventoryItem'),
  InventoryIssue: require('./InventoryIssue'),
  InventoryTransaction: require('./InventoryTransaction'),
  Counter: require('./Counter').Counter,
  AuthSession: require('./AuthSession'),
  Plan: require('./Plan'),
  Subscription: require('./Subscription'),
  // Stage 7 commercial-document collections (quotations, item-name
  // library, AMC document templates, payment-term templates).
  Quotation: require('./Quotation'),
  ItemName: require('./ItemName'),
  AmcTemplate: require('./AmcTemplate'),
  PaymentTermTemplate: require('./PaymentTermTemplate'),
  QuotationTemplate: require('./QuotationTemplate'),
  DailyTask: require('./DailyTask'),
  // Owner decision (21 Oct 2026): phones registered for push notifications.
  PushDevice: require('./PushDevice'),
  // Owner decision (27 Oct 2026): the customer portal — a login for the
  // company's own AMC/Warranty clients, their sessions (deliberately not the
  // staff ones), and the photographs they send with a complaint.
  CustomerAccount: require('./CustomerAccount'),
  CustomerSession: require('./CustomerSession'),
  ServiceCallAttachment: require('./ServiceCallAttachment'),
  ProjectPhoto: require('./ProjectPhoto'),
};
