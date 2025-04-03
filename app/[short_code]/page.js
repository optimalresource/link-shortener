"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import { getLink } from "../services/linkService";
import Image from "next/image";

const ShortCodeRedirect = ({ params }) => {
  const router = useRouter();
  const [shortCode, setShortCode] = useState(null);
  const resolvedParams = use(params);

  useEffect(() => {
    if (resolvedParams && resolvedParams.short_code) {
      setShortCode(resolvedParams.short_code);
    }
  }, [resolvedParams]);

  useEffect(() => {
    if (shortCode) {
      const fetchLink = async () => {
        try {
          const { data } = await getLink(shortCode);

          if (data && data.original_url) {
            window.location.href = data.original_url;
          } else {
            router.push("/404");
          }
        } catch (error) {
          console.error("Error fetching link:", error);
          router.push("/404");
        }
      };

      fetchLink();
    }
  }, [shortCode, router]);

  return (
    <div className="h-[100vh] w-[100vw] flex items-center justify-center p-5">
      <Image src="/hc_icon.png" width={100} height={100} alt="logo" />
    </div>
  );
};

export default ShortCodeRedirect;
