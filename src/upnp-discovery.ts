/**
 * upnp-discovery.ts — UPnP 자동 포트 매핑 + 공인 IP 발견
 *
 * 노드 시작 시:
 *   1) UPnP로 라우터에 포트 매핑 요청
 *   2) 성공 → 공인 IP:port 반환 (직접 연결 가능)
 *   3) 실패 → null 반환 (릴레이 모드 폴백)
 *
 * 종료 시 매핑 해제.
 */

import { createClient, type Client } from 'nat-upnp';

export interface UPnPResult {
  /** 공인 IP */
  externalIp: string;
  /** 외부에서 접근 가능한 포트 */
  externalPort: number;
  /** 완성된 공인 URL */
  publicUrl: string;
}

const MAPPING_DESCRIPTION = 'Elemental Clash Game Node';
const MAPPING_TTL = 3600; // 1시간 (heartbeat에서 갱신)

let _client: Client | null = null;
let _mappedPort: number | null = null;

/**
 * UPnP 포트 매핑 시도.
 * 성공 시 공인 IP와 포트를 반환, 실패 시 null.
 */
export async function tryUPnPMapping(localPort: number): Promise<UPnPResult | null> {
  return new Promise((resolve) => {
    // 전체 타임아웃: 10초
    const timeout = setTimeout(() => {
      console.log('[UPnP] 타임아웃 (10초) — UPnP 미지원 또는 비활성');
      cleanup();
      resolve(null);
    }, 10_000);

    try {
      _client = createClient();

      // 1단계: 공인 IP 확인
      _client.externalIp((ipErr, ip) => {
        if (ipErr || !ip) {
          console.log(`[UPnP] 공인 IP 확인 실패: ${ipErr?.message ?? '응답 없음'}`);
          clearTimeout(timeout);
          cleanup();
          resolve(null);
          return;
        }

        console.log(`[UPnP] 공인 IP 발견: ${ip}`);

        // 2단계: 포트 매핑
        _client!.portMapping({
          public: localPort,
          private: localPort,
          protocol: 'TCP',
          description: MAPPING_DESCRIPTION,
          ttl: MAPPING_TTL,
        }, (mapErr) => {
          clearTimeout(timeout);

          if (mapErr) {
            console.log(`[UPnP] 포트 매핑 실패: ${mapErr.message}`);
            cleanup();
            resolve(null);
            return;
          }

          _mappedPort = localPort;
          const publicUrl = `ws://${ip}:${localPort}`;
          console.log(`[UPnP] 포트 매핑 성공: ${publicUrl}`);
          resolve({ externalIp: ip, externalPort: localPort, publicUrl });
        });
      });
    } catch (e: any) {
      clearTimeout(timeout);
      console.log(`[UPnP] 초기화 실패: ${e.message}`);
      cleanup();
      resolve(null);
    }
  });
}

/** UPnP 매핑 갱신 (heartbeat 주기로 호출) */
export async function refreshUPnPMapping(localPort: number): Promise<boolean> {
  if (!_client || _mappedPort === null) return false;

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve(false);
    }, 5_000);

    _client!.portMapping({
      public: localPort,
      private: localPort,
      protocol: 'TCP',
      description: MAPPING_DESCRIPTION,
      ttl: MAPPING_TTL,
    }, (err) => {
      clearTimeout(timeout);
      resolve(!err);
    });
  });
}

/** 포트 매핑 해제 + 리소스 정리 */
export async function removeUPnPMapping(): Promise<void> {
  if (!_client || _mappedPort === null) return;

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, 3_000);

    _client!.portUnmapping({
      public: _mappedPort!,
      protocol: 'TCP',
    }, () => {
      clearTimeout(timeout);
      console.log(`[UPnP] 포트 매핑 해제: ${_mappedPort}`);
      cleanup();
      resolve();
    });
  });
}

function cleanup() {
  if (_client) {
    try { _client.close(); } catch { /* ignore */ }
    _client = null;
  }
  _mappedPort = null;
}
