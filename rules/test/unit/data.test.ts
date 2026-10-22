import { describe, it, expect } from 'vitest';
import { analyze } from '@linkclean/core';
import type { KnowledgeEntry } from '@linkclean/core';
import overrides from '../../overrides.json';
import expanders from '../../expanders.json';
import knowledge from '../../knowledge.json';
import { validateOwnData } from '../../src/bundle';
import type { OwnData } from '../../src/bundle';

const kb = knowledge as Record<string, KnowledgeEntry>;
const explain = (key: string, host: string) => analyze([{ key, value: 'v', host }], kb, 'en')[0]!;

describe('checked-in rule data', () => {
  it('passes validation', () => {
    expect(validateOwnData({ overrides, expanders, knowledge } as OwnData)).toEqual([]);
  });

  it('explains generic ref / referrer params as referral codes', () => {
    for (const key of ['ref', 'referrer']) {
      const p = explain(key, 'example.com');
      expect(p.category).toBe('affiliate');
      expect(p.desc).toBeDefined();
    }
  });

  it('does not call Amazon page-navigation ref a referral code', () => {
    for (const host of ['www.amazon.com', 'www.amazon.co.jp']) {
      for (const key of ['ref', 'ref_']) expect(explain(key, host).category).toBe('session');
    }
  });

  it('explains Facebook mibextid as a share-source label', () => {
    const p = explain('mibextid', 'www.facebook.com');
    expect(p.category).toBe('campaign');
    expect(p.owner).toBe('Meta');
  });

  it('explains the share code of every expanded share-link host', () => {
    const hosts = ['www.facebook.com', 'www.threads.com', 'vt.tiktok.com', 'b23.tv', 'bili2233.cn', 'xhslink.com', 'www.reddit.com'];
    for (const host of hosts) expect(explain('share-id', host).category, host).toBe('sharer_id');
  });

  it('explains share params of common social and video platforms', () => {
    const cases: [string, string, string][] = [
      ['x.com', 't', 'sharer_id'],
      ['x.com', 's', 'campaign'],
      ['twitter.com', 't', 'sharer_id'],
      ['twitter.com', 's', 'campaign'],
      ['www.reddit.com', 'share_id', 'sharer_id'],
      ['www.tiktok.com', '_t', 'sharer_id'],
      ['www.tiktok.com', 'u_code', 'sharer_id'],
      ['www.tiktok.com', '_r', 'campaign'],
      ['www.xiaohongshu.com', 'shareRedId', 'sharer_id'],
      ['www.xiaohongshu.com', 'share_id', 'sharer_id'],
      ['www.xiaohongshu.com', 'author_share', 'session'],
      ['www.xiaohongshu.com', 'share_from_user_hidden', 'session'],
      ['www.xiaohongshu.com', 'app_platform', 'campaign'],
      ['www.xiaohongshu.com', 'apptime', 'session'],
      ['www.xiaohongshu.com', 'xsec_source', 'campaign'],
      ['www.xiaohongshu.com', 'ignoreEngage', 'session'],
      ['www.xiaohongshu.com', 'type', 'session'],
      ['www.bilibili.com', 'vd_source', 'sharer_id'],
      ['www.bilibili.com', 'share_source', 'campaign'],
      ['www.bilibili.com', 'share_medium', 'campaign'],
      ['www.bilibili.com', 'spm_id_from', 'session'],
      ['www.youtube.com', 'pp', 'session'],
      ['www.youtube.com', 'feature', 'campaign'],
      ['youtu.be', 'feature', 'campaign'],
      ['www.tiktok.com', 'share_item_id', 'session'],
      ['www.tiktok.com', 'share_app_id', 'campaign'],
      ['www.tiktok.com', 'sender_device', 'campaign'],
      ['www.tiktok.com', 'is_from_webapp', 'campaign'],
      ['www.tiktok.com', 'share_link_id', 'sharer_id'],
      ['www.tiktok.com', 'social_share_type', 'campaign'],
      ['www.pinterest.com', 'invite_code', 'sharer_id'],
      ['www.pinterest.com', 'sender', 'sharer_id'],
      ['www.pinterest.com', 'sfo', 'campaign'],
      ['www.pinterest.com', 'mt', 'session'],
      ['www.snapchat.com', 'share_id', 'sharer_id'],
      ['www.linkedin.com', 'rcm', 'sharer_id'],
      ['www.instagram.com', 'exln', 'sharer_id'],
      ['www.bilibili.com', 'bbid', 'sharer_id'],
      ['www.bilibili.com', 'ts', 'session'],
      ['www.instagram.com', 'stkn', 'sharer_id'],
    ];
    for (const [host, key, category] of cases) {
      const p = explain(key, host);
      expect([host, key, p.category]).toEqual([host, key, category]);
      expect(p.desc).toBeDefined();
    }
  });

  it('explains ad click IDs with the ad platform that owns them', () => {
    const owners: [string, string][] = [
      ['fbclid', 'Meta'],
      ['gclid', 'Google'],
      ['dclid', 'Google'],
      ['msclkid', 'Microsoft'],
      ['twclid', 'X'],
      ['yclid', 'Yandex'],
    ];
    for (const [key, owner] of owners) {
      const p = explain(key, 'github.com');
      expect([key, p.category, p.owner]).toEqual([key, 'ad_click', owner]);
      expect(p.desc).toBeDefined();
    }
  });

  it('explains every known rotating Instagram share ID name as a sharer ID', () => {
    for (const host of ['www.instagram.com', 'instagr.am']) {
      for (const key of ['stkn', 'exln', 'xtok', 'rpxt', 'vrfl', 'obrf', 'psln', 'cplk', 'mdxt', 'srtk', 'dlrf']) {
        const p = explain(key, host);
        expect([host, key, p.category]).toEqual([host, key, 'sharer_id']);
        expect(p.desc).toBeDefined();
      }
    }
  });

  it('explains the Trip.com hotel trackers as Trip.com session data', () => {
    const keys = ['UniqueKey', 'masterhotelid_tracelogid', 'fromPageId', 'fromList', 'listScene', 'isFirstEnterDetailPage', 'subStamp'];
    for (const key of keys) {
      const p = explain(key, 'tw.trip.com');
      expect([key, p.category, p.owner]).toEqual([key, 'session', 'Trip.com']);
      expect(p.desc).toBeDefined();
    }
  });
});
