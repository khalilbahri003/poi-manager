const API_URL = process.env.REACT_APP_API_URL || '';

export const apiRequest = async (endpoint, method = 'GET', data = null) => {
  const options = {
    method,
    credentials: 'include',
    headers: { Accept: 'application/json' },
  };
  if (data !== null) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(data);
  }
  try {
    const response = await fetch(`${API_URL}/api/${endpoint.replace(/^\/+/, '')}`, options);
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || `Request failed (${response.status})`);
    return result;
  } catch (error) {
    return { status: 'error', message: error.message || 'Unable to contact the server.' };
  }
};
