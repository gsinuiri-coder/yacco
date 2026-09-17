/**
 * La condición y el mapeo del proveedor de Workload Identity Federation.
 *
 * Aparte de gcp-bootstrap.mjs porque ese script corre al importarlo, y esto
 * es lo que más conviene tener cubierto por un test: un carácter de más en la
 * condición deja el deploy sin credenciales, y uno de menos deja entrar a quien
 * no debe.
 */

// Lo que cada token de OIDC de GitHub trae y la condición exige. Los ids no
// son secretos: identifican, no autorizan.
export const GITHUB_REPOSITORY = "gsinuiri-coder/yacco";
export const GITHUB_REPOSITORY_ID = "1339102029";
export const GITHUB_REPOSITORY_OWNER_ID = "71910095";
export const DEPLOY_WORKFLOW_PATH = ".github/workflows/deploy.yml";
export const DEPLOY_REF = "refs/heads/main";

/**
 * Cuatro anclas, cada una contra un ataque distinto:
 *
 * - `repository` + `repository_id` + `repository_owner_id` (A8, fase 6): el
 *   nombre solo no alcanza. Si el repo se renombra o se borra, otra cuenta
 *   puede crear uno con el mismo nombre, y su token diría el mismo
 *   `repository`. Los ids numéricos no se reciclan.
 * - `ref` (D-014): sólo lo que ya está en main. Un workflow agregado en un PR
 *   sin mergear no alcanza las credenciales.
 * - `workflow_ref` (A3): sólo `deploy.yml`, y sólo su versión de main. Sin
 *   esto, CUALQUIER workflow de main —ci.yml, codeql.yml, uno que se agregue
 *   mañana— podría pedir `id-token: write` y hacerse pasar por el deployer.
 */
export function wifAttributeCondition({
  repository = GITHUB_REPOSITORY,
  repositoryId = GITHUB_REPOSITORY_ID,
  ownerId = GITHUB_REPOSITORY_OWNER_ID,
} = {}) {
  return [
    `assertion.repository == '${repository}'`,
    `assertion.repository_id == '${repositoryId}'`,
    `assertion.repository_owner_id == '${ownerId}'`,
    `assertion.ref == '${DEPLOY_REF}'`,
    `assertion.workflow_ref == '${repository}/${DEPLOY_WORKFLOW_PATH}@${DEPLOY_REF}'`,
  ].join(" && ");
}

export const WIF_ATTRIBUTE_MAPPING = [
  "google.subject=assertion.sub",
  "attribute.repository=assertion.repository",
  "attribute.repository_id=assertion.repository_id",
  "attribute.ref=assertion.ref",
  "attribute.workflow_ref=assertion.workflow_ref",
].join(",");
