/**
 * @license Copyright 2017 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

const Runner = require('../../../runner');
const ByteEfficiencyAudit_ = require('../../../audits/byte-efficiency/byte-efficiency-audit');
const NetworkNode = require('../../../lib/dependency-graph/network-node');
const CPUNode = require('../../../lib/dependency-graph/cpu-node');
const Simulator = require('../../../lib/dependency-graph/simulator/simulator');

const trace = require('../../fixtures/traces/progressive-app-m60.json');
const devtoolsLog = require('../../fixtures/traces/progressive-app-m60.devtools.log.json');
const assert = require('assert');

/* eslint-env jest */

describe('Byte efficiency base audit', () => {
  let graph;
  let simulator;

  const ByteEfficiencyAudit = class extends ByteEfficiencyAudit_ {
    static get meta() {
      return {name: 'test'};
    }
  };

  beforeEach(() => {
    const networkRecord = {
      requestId: 1,
      url: 'http://example.com/',
      parsedURL: {scheme: 'http', securityOrigin: () => 'http://example.com'},
      transferSize: 400000,
      _timing: {receiveHeadersEnd: 0},
    };

    graph = new NetworkNode(networkRecord);
    // add a CPU node to force improvement to TTI
    graph.addDependent(new CPUNode({tid: 1, ts: 0, dur: 100 * 1000}));
    simulator = new Simulator({});
  });

  const baseHeadings = [
    {key: 'totalBytes', itemType: 'bytes', displayUnit: 'kb', granularity: 1, text: ''},
    {key: 'wastedBytes', itemType: 'bytes', displayUnit: 'kb', granularity: 1, text: ''},
    {key: 'wastedMs', itemType: 'text', text: ''},
  ];

  describe('#estimateTransferSize', () => {
    const estimate = ByteEfficiencyAudit.estimateTransferSize;

    it('should estimate by compression ratio when no network record available', () => {
      const result = estimate(undefined, 1000, '', 0.345);
      assert.equal(result, 345);
    });

    it('should return transferSize when asset matches', () => {
      const _resourceType = {_name: 'stylesheet'};
      const result = estimate({transferSize: 1234, _resourceType}, 10000, 'stylesheet');
      assert.equal(result, 1234);
    });

    it('should estimate by network compression ratio when asset does not match', () => {
      const _resourceType = {_name: 'other'};
      const result = estimate({_resourceSize: 2000, transferSize: 1000, _resourceType}, 100);
      assert.equal(result, 50);
    });

    it('should not error when missing resource size', () => {
      const _resourceType = {_name: 'other'};
      const result = estimate({transferSize: 1000, _resourceType}, 100);
      assert.equal(result, 100);
    });
  });

  it('should format details', () => {
    const result = ByteEfficiencyAudit.createAuditProduct({
      headings: baseHeadings,
      items: [],
    }, graph, simulator);

    assert.deepEqual(result.details.items, []);
  });

  it('should set the rawValue', () => {
    const result = ByteEfficiencyAudit.createAuditProduct(
      {
        headings: baseHeadings,
        items: [
          {url: 'http://example.com/', wastedBytes: 200 * 1000},
        ],
      },
      graph,
      simulator
    );

    // 900ms savings comes from the graph calculation
    assert.equal(result.rawValue, 900);
  });

  it('should score the wastedMs', () => {
    const perfectResult = ByteEfficiencyAudit.createAuditProduct({
      headings: baseHeadings,
      items: [{url: 'http://example.com/', wastedBytes: 1 * 1000}],
    }, graph, simulator);

    const goodResult = ByteEfficiencyAudit.createAuditProduct({
      headings: baseHeadings,
      items: [{url: 'http://example.com/', wastedBytes: 20 * 1000}],
    }, graph, simulator);

    const averageResult = ByteEfficiencyAudit.createAuditProduct({
      headings: baseHeadings,
      items: [{url: 'http://example.com/', wastedBytes: 100 * 1000}],
    }, graph, simulator);

    const failingResult = ByteEfficiencyAudit.createAuditProduct({
      headings: baseHeadings,
      items: [{url: 'http://example.com/', wastedBytes: 400 * 1000}],
    }, graph, simulator);

    assert.equal(perfectResult.score, 1, 'scores perfect wastedMs');
    assert.ok(goodResult.score > 0.75 && goodResult.score < 1, 'scores good wastedMs');
    assert.ok(averageResult.score > 0.5 && averageResult.score < 0.75, 'scores average wastedMs');
    assert.ok(failingResult.score < 0.5, 'scores failing wastedMs');
  });

  it('should throw on invalid graph', () => {
    assert.throws(() => {
      ByteEfficiencyAudit.createAuditProduct({
        headings: baseHeadings,
        items: [{wastedBytes: 350, totalBytes: 700, wastedPercent: 50}],
      }, null);
    });
  });

  it('should populate KB', () => {
    const result = ByteEfficiencyAudit.createAuditProduct({
      headings: baseHeadings,
      items: [
        {wastedBytes: 2048, totalBytes: 4096, wastedPercent: 50},
        {wastedBytes: 1986, totalBytes: 5436},
      ],
    }, graph, simulator);

    assert.equal(result.details.items[0].wastedBytes, 2048);
    assert.equal(result.details.items[0].totalBytes, 4096);
    assert.equal(result.details.items[1].wastedBytes, 1986);
    assert.equal(result.details.items[1].totalBytes, 5436);
  });

  it('should sort on wastedBytes', () => {
    const result = ByteEfficiencyAudit.createAuditProduct({
      headings: baseHeadings,
      items: [
        {wastedBytes: 350, totalBytes: 700, wastedPercent: 50},
        {wastedBytes: 450, totalBytes: 1000, wastedPercent: 50},
        {wastedBytes: 400, totalBytes: 450, wastedPercent: 50},
      ],
    }, graph, simulator);

    assert.equal(result.details.items[0].wastedBytes, 450);
    assert.equal(result.details.items[1].wastedBytes, 400);
    assert.equal(result.details.items[2].wastedBytes, 350);
  });

  it('should create a display value', () => {
    const result = ByteEfficiencyAudit.createAuditProduct({
      headings: baseHeadings,
      items: [
        {wastedBytes: 512, totalBytes: 700, wastedPercent: 50},
        {wastedBytes: 512, totalBytes: 1000, wastedPercent: 50},
        {wastedBytes: 1024, totalBytes: 1200, wastedPercent: 50},
      ],
    }, graph, simulator);

    assert.ok(result.displayValue.includes(2), 'contains correct KB');
  });

  it('should work on real graphs', async () => {
    const throttling = {rttMs: 150, throughputKbps: 1600, cpuSlowdownMultiplier: 1};
    const settings = {throttlingMethod: 'simulate', throttling};
    const artifacts = Runner.instantiateComputedArtifacts();
    const graph = await artifacts.requestPageDependencyGraph({trace, devtoolsLog});
    const simulator = await artifacts.requestLoadSimulator({devtoolsLog, settings});
    const result = ByteEfficiencyAudit.createAuditProduct(
      {
        headings: [{key: 'value', text: 'Label'}],
        items: [
          {url: 'https://www.googletagmanager.com/gtm.js?id=GTM-Q5SW', wastedBytes: 30 * 1024},
        ],
      },
      graph,
      simulator
    );

    assert.equal(result.rawValue, 300);
  });

  it('should create load simulator with the specified settings', async () => {
    class MockAudit extends ByteEfficiencyAudit {
      static audit_(artifacts, records) {
        return {
          items: records.map(record => ({url: record.url, wastedBytes: record.transferSize})),
          headings: [],
        };
      }
    }

    const artifacts = Runner.instantiateComputedArtifacts();
    artifacts.traces = {defaultPass: trace};
    artifacts.devtoolsLogs = {defaultPass: devtoolsLog};

    const modestThrottling = {rttMs: 150, throughputKbps: 1000, cpuSlowdownMultiplier: 2};
    const ultraSlowThrottling = {rttMs: 150, throughputKbps: 100, cpuSlowdownMultiplier: 8};
    let settings = {throttlingMethod: 'simulate', throttling: modestThrottling};
    let result = await MockAudit.audit(artifacts, {settings});
    // expect modest savings
    assert.equal(result.rawValue, 1480);

    settings = {throttlingMethod: 'simulate', throttling: ultraSlowThrottling};
    result = await MockAudit.audit(artifacts, {settings});
    // expect lots of savings
    assert.equal(result.rawValue, 22350);
  });

  it('should allow overriding of computeWasteWithTTIGraph', async () => {
    class MockAudit extends ByteEfficiencyAudit {
      static audit_(artifacts, records) {
        return {
          items: records.map(record => ({url: record.url, wastedBytes: record.transferSize})),
          headings: [],
        };
      }
    }

    class MockJustTTIAudit extends MockAudit {
      static computeWasteWithTTIGraph(results, graph, simulator) {
        return ByteEfficiencyAudit.computeWasteWithTTIGraph(results, graph, simulator,
          {includeLoad: false});
      }
    }

    const artifacts = Runner.instantiateComputedArtifacts();
    artifacts.traces = {defaultPass: trace};
    artifacts.devtoolsLogs = {defaultPass: devtoolsLog};

    const modestThrottling = {rttMs: 150, throughputKbps: 1000, cpuSlowdownMultiplier: 2};
    const settings = {throttlingMethod: 'simulate', throttling: modestThrottling};
    const result = await MockAudit.audit(artifacts, {settings});
    const resultTti = await MockJustTTIAudit.audit(artifacts, {settings});
    // expect more savings from default
    assert.equal(result.rawValue, 1480);
    assert.equal(resultTti.rawValue, 800);
  });
});
