import { useEffect, useState } from 'react';
import { useRouter } from '../lib/useRouter';

/** ヘッダ常設の横断検索ボックス。Enter で /search?q=... へ遷移 */
export function SearchBox() {
  const { route, navigate } = useRouter();
  const [value, setValue] = useState(route.name === 'search' ? route.q : '');

  // /search の q が外部要因(戻る/進む等)で変わったら同期
  useEffect(() => {
    if (route.name === 'search') setValue(route.q);
  }, [route]);

  const submit = () => {
    const q = value.trim();
    navigate({ name: 'search', q });
  };

  return (
    <div className="searchbox">
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
        placeholder="横断検索(メモ・選定・文字起こし)"
        aria-label="横断検索"
      />
    </div>
  );
}
