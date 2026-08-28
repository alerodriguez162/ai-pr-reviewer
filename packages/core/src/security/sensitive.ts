export interface SensitiveMatch {
  path: string;
  areas: string[];
}

const SENSITIVE_AREA_PATTERNS: Array<{ area: string; pattern: RegExp }> = [
  { area: "authentication", pattern: /(^|\/)(auth|oauth|oidc|sso|login|signin|session)(\/|$|\.)/i },
  { area: "authorization", pattern: /(rbac|acl|permission|authorize|policy|iam)s?/i },
  { area: "payments", pattern: /(payment|billing|stripe|paypal|checkout|invoice)/i },
  { area: "database", pattern: /(prisma|sequelize|typeorm|mongoose|sql|database|db\/)/i },
  { area: "migrations", pattern: /(^|\/)migrations?\//i },
  { area: "api-routes", pattern: /(^|\/)(api|routes|controllers|handlers|endpoints)\//i },
  { area: "middleware", pattern: /(middleware|guard|interceptor)/i },
  { area: "environment", pattern: /(^|\/)\.env/i },
  { area: "permissions", pattern: /(permission|role|scope)/i },
  { area: "security", pattern: /(security|csrf|cors|csp|jwt|crypto|secret)/i },
  { area: "ci-cd", pattern: /(^|\/)\.github\/|gitlab-ci|jenkins|circleci|azure-pipelines/i },
  { area: "dependencies", pattern: /(^|\/)(package\.json|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|composer\.json|go\.mod|Cargo\.toml|Gemfile|requirements\.txt|poetry\.lock)$/ },
  { area: "docker", pattern: /(dockerfile|docker-compose|\.dockerignore)/i },
  { area: "infrastructure", pattern: /(terraform|pulumi|helm|kustomize|kubernetes|cloudformation|\.tf$)/i },
];

export function classifySensitiveFile(path: string): string[] {
  const areas: string[] = [];
  for (const { area, pattern } of SENSITIVE_AREA_PATTERNS) {
    if (pattern.test(path) && !areas.includes(area)) {
      areas.push(area);
    }
  }
  return areas;
}

export function detectSensitiveFiles(paths: string[]): SensitiveMatch[] {
  return paths
    .map((path) => ({ path, areas: classifySensitiveFile(path) }))
    .filter((match) => match.areas.length > 0);
}

export function uniqueSensitiveAreas(paths: string[]): string[] {
  const areas = new Set<string>();
  for (const path of paths) {
    for (const area of classifySensitiveFile(path)) {
      areas.add(area);
    }
  }
  return [...areas].sort();
}

export function isSensitivePath(path: string): boolean {
  return classifySensitiveFile(path).length > 0;
}
