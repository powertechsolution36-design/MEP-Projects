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
};
