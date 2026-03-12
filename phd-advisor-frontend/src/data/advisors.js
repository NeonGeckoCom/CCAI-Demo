/**
 * DEPRECATED — advisor data is now served dynamically by the backend
 * via GET /api/config and consumed through AppConfigContext.
 *
 * Components should use:
 *   const { advisors, getAdvisorColors, resolveIcon } = useAppConfig();
 *
 * This file is kept only for reference / backward-compatibility of any
 * third-party code that may still import it.  The static data below is
 * a snapshot of the PhD Advisory Panel defaults and will NOT be updated
 * when config.yaml changes.
 */

// If you need advisor data in a non-React context, fetch /api/config
// instead of importing from this file.

export const advisors = {};
export const getAdvisorColors = () => ({ color: '#6B7280', bgColor: '#F3F4F6', textColor: '#374151' });
export const getAdvisorById = () => undefined;
export const getAdvisorSpecialties = () => [];
export const getAdvisorExpertise = () => ({});
export const getDocumentHandlingInfo = () => 'Provides general guidance based on uploaded documents';
export const getSampleQuestionsForDocuments = () => [];
export const getAdvisorDocumentTypes = () => [];
export const getAdvisorsList = () => [];
export const getAdvisorIds = () => [];
