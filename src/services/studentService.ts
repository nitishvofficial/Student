import { supabase } from './supabaseClient';

export interface Student {
  student_uid: string;
  name: string;
  section_id: string;
  course: string;
  branch: string;
  semester: string;
  section: string;
}

export const studentService = {
  /**
   * Performs a background sync of student face embeddings.
   * Uses delta-sync if previously synced, otherwise paginated full sync.
   * Tolerates captive portals and offline networks by failing silently.
   */
  async backgroundSyncEmbeddings(): Promise<void> {
    const { storageService } = await import('./storageService');
    const lastSyncedAt = storageService.getObject('last_synced_at') as string | null;
    const now = Date.now();

    // Check staleness threshold if not forcing
    const lastSyncMs = lastSyncedAt ? new Date(lastSyncedAt).getTime() : 0;
    
    if (lastSyncedAt) {
      console.log('CACHE_LOADED');
    } else {
      console.log('CACHE_EMPTY');
    }
    if (now - lastSyncMs < 5 * 60 * 1000) { // 5 minutes threshold
      console.log('USING_LOCAL_CACHE');
      return;
    }

    console.log('BACKGROUND_SYNC_STARTED');
    console.log(`[StudentService] (Last Sync: ${lastSyncedAt || 'Never'})`);

    const SYNC_TIMEOUT_MS = 10000; // 10 seconds
    const MAX_RETRIES = 2;

    const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('TIMEOUT')), ms);
        promise.then(v => { clearTimeout(timer); resolve(v); })
               .catch(e => { clearTimeout(timer); reject(e); });
      });
    };

    const fetchWithRetry = async <T>(operation: () => Promise<T>): Promise<T> => {
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          return await withTimeout(operation(), SYNC_TIMEOUT_MS);
        } catch (err: any) {
          const msg = err.message || '';
          if (msg.includes('Unexpected token') || msg.includes('JSON')) {
            console.error('[StudentService] Captive Portal/Firewall detected (HTML returned).');
            throw new Error('CAPTIVE_PORTAL');
          }
          if (attempt === MAX_RETRIES) throw err;
          await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt))); // Exp backoff
        }
      }
      throw new Error('UNREACHABLE');
    };

    try {
      let fetchedStudents: any[] = [];
      let page = 0;
      const PAGE_SIZE = 200;
      
      if (lastSyncedAt) {
        // DELTA SYNC
        console.log('[StudentService] Fetching delta updates...');
        const res = await fetchWithRetry(() => 
          supabase
            .from('students')
            .select('student_uid, name, face_embedding')
            .gt('updated_at', lastSyncedAt)
        );
        if (res.error) throw res.error;
        fetchedStudents = res.data || [];
      } else {
        // FULL PAGINATED SYNC
        console.log('[StudentService] Performing full paginated sync...');
        while (true) {
          const res = await fetchWithRetry(() => 
            supabase
              .from('students')
              .select('student_uid, name, face_embedding')
              .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
          );
          if (res.error) throw res.error;
          const data = res.data || [];
          fetchedStudents = fetchedStudents.concat(data);
          if (data.length < PAGE_SIZE) break;
          page++;
        }
      }

      if (fetchedStudents.length > 0) {
        const currentCache = storageService.getObject('studentEmbeddings') || {};
        
        fetchedStudents.forEach((s: any) => {
          if (s.face_embedding && Array.isArray(s.face_embedding)) {
            const raw: number[] = s.face_embedding;
            const norm = Math.sqrt(raw.reduce((sum, v) => sum + v * v, 0));
            const normalized = norm > 0 ? raw.map(v => v / norm) : raw;
            currentCache[s.student_uid] = {
              name: s.name,
              embedding: normalized,
            };
          }
        });

        storageService.setObject('studentEmbeddings', currentCache);
        console.log('USING_UPDATED_CACHE');
        console.log(`[StudentService] Merged ${fetchedStudents.length} student updates into cache.`);
      }

      storageService.setObject('last_synced_at', new Date().toISOString());
      console.log('BACKGROUND_SYNC_COMPLETED');
      
    } catch (err: any) {
      // Fail silently, preserving cache so the app functions normally
      console.log('BACKGROUND_SYNC_FAILED');
      console.log(`[StudentService] Background sync failed (${err.message}). Using local cache.`);
      console.log('USING_LOCAL_CACHE');
    }
  },

  /**
   * Escape hatch for staff to manually trigger a full resync.
   * Clears the sync timestamp and forces the background sync to run immediately.
   */
  async forceFullSync(): Promise<void> {
    console.log('[StudentService] FORCING full sync...');
    const { storageService } = await import('./storageService');
    storageService.setObject('last_synced_at', null); // Wipe timestamp
    await this.backgroundSyncEmbeddings();
  },

  /**
   * Fetch students for a specific section.
   */
  async getStudentsBySection(section_id: string): Promise<Student[]> {
    try {
      const { data, error } = await supabase
        .from('students')
        .select('*')
        .eq('section_id', section_id);

      if (error) {
        throw error;
      }

      return data as Student[];
    } catch (error: any) {
      console.warn('Using mock data for getStudentsBySection.');
      return [
        {
          student_uid: 'S101',
          name: 'Alice Johnson',
          section_id,
          course: 'B.Tech',
          branch: 'CSE',
          semester: '6',
          section: 'A',
        },
      ];
    }
  },

  /**
   * Fetch students using course, branch, semester, and section.
   */
  async getStudentsByClassDetails(
    course: string,
    branch: string,
    semester: string,
    section: string,
  ): Promise<Student[]> {
    try {
      const { data, error } = await supabase
        .from('students')
        .select('*')
        .eq('course', course)
        .eq('branch', branch)
        .eq('semester', semester)
        .eq('section', section);

      if (error) {
        throw error;
      }

      return data as Student[];
    } catch (error: any) {
      return [
        {
          student_uid: 'S101',
          name: 'Alice Johnson',
          section_id: 'SEC_A',
          course,
          branch,
          semester,
          section,
        },
      ];
    }
  },
};
