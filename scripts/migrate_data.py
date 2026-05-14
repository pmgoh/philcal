#!/usr/bin/env python3
"""
JSON 마이그레이션 스크립트
─────────────────────────
- schools: promotions가 빈 배열이면 null로 변환 (확인됨 vs 미확인 구분)
- promotions: schoolId 자동 매칭 시도. 별칭 사전 기반.

사용법:
  python3 scripts/migrate_data.py \
    --schools-in  schools_in.json \
    --promos-in   promos_in.json \
    --aliases     data/school-aliases.json \
    --schools-out schools_out.json \
    --promos-out  promos_out.json \
    --report      report.json
"""

import argparse
import json
import re
import sys
from pathlib import Path


def normalize_school_name(s: str) -> str:
    """schoolMatching.ts의 normalizeSchoolName과 동일한 로직"""
    if not s:
        return ''
    s = s.lower()
    s = re.sub(r'\([^)]*\)', '', s)
    s = re.sub(r'[·•・\-_/\\]', '', s)
    s = re.sub(r'\s+', '', s)
    s = re.sub(r'[^\w가-힣]', '', s, flags=re.UNICODE)
    return s.strip()


def build_alias_index(aliases: dict) -> dict:
    """별칭 사전 → 정규화 기반 역인덱스"""
    idx = {}
    for canonical, alts in aliases.items():
        c_key = normalize_school_name(canonical)
        if c_key:
            idx[c_key] = canonical
        for a in alts:
            a_key = normalize_school_name(a)
            if a_key:
                idx[a_key] = canonical
    return idx


def find_school_id(promo_school_name: str, schools: list, alias_idx: dict) -> str | None:
    """프로모션 schoolName으로 school id 찾기"""
    if not promo_school_name:
        return None
    promo_key = normalize_school_name(promo_school_name)

    # 1) 정확 일치
    for s in schools:
        if s.get('name') == promo_school_name:
            return s['id']

    # 2) 정규화 일치
    for s in schools:
        if normalize_school_name(s.get('name', '')) == promo_key:
            return s['id']

    # 3) 별칭 사전 경유
    canonical = alias_idx.get(promo_key)
    if canonical:
        for s in schools:
            if s.get('name') == canonical:
                return s['id']

    # 4) 학원 자체 aliases 필드
    for s in schools:
        for a in s.get('aliases', []) or []:
            if normalize_school_name(a) == promo_key:
                return s['id']

    return None


def migrate_schools(schools: list) -> tuple[list, dict]:
    """
    schools.promotions = [] 인 경우 null로 변환 (미확인 표시)
    이미 promo가 들어있는 학원은 그대로 둔다.
    """
    migrated = []
    stats = {'total': 0, 'set_null': 0, 'has_promos': 0, 'already_null': 0}
    for s in schools:
        stats['total'] += 1
        new_s = dict(s)
        p = s.get('promotions')
        if p is None:
            stats['already_null'] += 1
            new_s['promotions'] = None
        elif isinstance(p, list) and len(p) == 0:
            stats['set_null'] += 1
            new_s['promotions'] = None
        else:
            stats['has_promos'] += 1
            new_s['promotions'] = p
        migrated.append(new_s)
    return migrated, stats


def migrate_promos(promos: list, schools: list, alias_idx: dict) -> tuple[list, dict, list]:
    """
    프로모션에 schoolId 자동 매칭.
    매칭 실패한 promo는 schoolId 필드 없음 = 미연결 상태.
    """
    migrated = []
    orphans = []
    stats = {'total': 0, 'matched': 0, 'orphan': 0, 'already_had_id': 0}
    for p in promos:
        stats['total'] += 1
        new_p = dict(p)
        if p.get('schoolId'):
            stats['already_had_id'] += 1
            migrated.append(new_p)
            continue

        sid = find_school_id(p.get('schoolName', ''), schools, alias_idx)
        if sid:
            new_p['schoolId'] = sid
            stats['matched'] += 1
        else:
            stats['orphan'] += 1
            orphans.append({
                'id': p.get('id'),
                'schoolName': p.get('schoolName'),
                'promoName': p.get('promoName'),
                'active': p.get('active', True),
            })
        migrated.append(new_p)
    return migrated, stats, orphans


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--schools-in', required=True)
    ap.add_argument('--promos-in', required=True)
    ap.add_argument('--aliases', required=True)
    ap.add_argument('--schools-out', required=True)
    ap.add_argument('--promos-out', required=True)
    ap.add_argument('--report', required=True)
    args = ap.parse_args()

    schools = json.loads(Path(args.schools_in).read_text(encoding='utf-8'))
    promos = json.loads(Path(args.promos_in).read_text(encoding='utf-8'))
    aliases = json.loads(Path(args.aliases).read_text(encoding='utf-8'))

    alias_idx = build_alias_index(aliases)

    new_schools, school_stats = migrate_schools(schools)
    new_promos, promo_stats, orphans = migrate_promos(promos, new_schools, alias_idx)

    Path(args.schools_out).write_text(
        json.dumps(new_schools, ensure_ascii=False, indent=2), encoding='utf-8'
    )
    Path(args.promos_out).write_text(
        json.dumps(new_promos, ensure_ascii=False, indent=2), encoding='utf-8'
    )

    # 고아 프로모션을 학원명별로 그룹화 (확인 필요 탭에서 학원 추가 가이드용)
    orphans_by_school = {}
    for o in orphans:
        sn = o['schoolName'] or '(이름 없음)'
        orphans_by_school.setdefault(sn, []).append(o)

    report = {
        'schools': school_stats,
        'promos': promo_stats,
        'orphans_by_school': {
            sn: {'count': len(ps), 'active': sum(1 for p in ps if p['active']), 'promos': ps}
            for sn, ps in sorted(orphans_by_school.items(), key=lambda x: -len(x[1]))
        },
    }
    Path(args.report).write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8'
    )

    print('=== Schools ===')
    for k, v in school_stats.items():
        print(f'  {k}: {v}')
    print('=== Promotions ===')
    for k, v in promo_stats.items():
        print(f'  {k}: {v}')
    print(f'=== Orphan schools ({len(orphans_by_school)}) ===')
    for sn, ps in sorted(orphans_by_school.items(), key=lambda x: -len(x[1]))[:15]:
        print(f'  {sn}: {len(ps)}개')


if __name__ == '__main__':
    main()
