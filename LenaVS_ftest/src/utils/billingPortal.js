import api from '../services/api';

export const openBillingPortal = async ({ onStart, onFinish, onError } = {}) => {
  try {
    onStart?.();

    const { data } = await api.post('/payment/billing-portal');

    if (!data?.url) {
      throw new Error('Não foi possível abrir o portal de cobrança agora.');
    }

    window.location.href = data.url;
    return data;
  } catch (error) {
    const message =
      error.response?.data?.error ||
      error.response?.data?.details ||
      error.message ||
      'Erro ao abrir o portal de cobrança.';

    if (onError) {
      onError(message, error);
    }

    throw error;
  } finally {
    onFinish?.();
  }
};

export default openBillingPortal;
