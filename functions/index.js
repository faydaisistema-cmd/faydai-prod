const admin = require('firebase-admin');
admin.initializeApp();

exports.importInvites = require('./src/importInvites').importInvites;
exports.submitResponse = require('./src/submitResponse').submitResponse;
exports.computeAggregateReport = require('./src/computeAggregateReport').computeAggregateReport;
