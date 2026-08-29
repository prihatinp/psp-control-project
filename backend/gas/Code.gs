/**
 * Code.gs — Web App entry points only. All routing logic lives in
 * Router.gs so this file never grows into a monolith.
 *
 * GET is used for public, read-only lookups (?action=...&...params).
 * POST body is JSON text/plain (avoids a CORS preflight against the Web
 * App), shaped as { action, token, ...payload } — matches the existing
 * frontend's apiGet/apiPost helpers exactly.
 */

function doGet(e) {
  const action = e.parameter.action;
  const params = Object.assign({}, e.parameter);
  delete params.action;
  return jsonOut_(dispatch_(action, params, params.token));
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOut_({ ok: false, message: 'Invalid JSON body' });
  }
  const action = body.action;
  const token = body.token;
  const params = Object.assign({}, body);
  delete params.action;
  delete params.token;
  return jsonOut_(dispatch_(action, params, token));
}
