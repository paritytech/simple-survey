#![cfg_attr(not(feature = "abi-gen"), no_main, no_std)]

#[pvm_contract_sdk::contract(allocator = "pico", allocator_size = 65536)]
mod surveys {
    use alloc::string::String;
    use pvm_contract_sdk::{Address, Lazy, Mapping};

    pvm_contract_sdk::sol_revert_enum! {
        pub enum Error {
            SurveyNotFound(SurveyNotFound),
            ResponseNotFound(ResponseNotFound),
            AlreadyResponded(AlreadyResponded),
        }
    }

    #[derive(Debug, pvm_contract_sdk::SolError)]
    pub struct SurveyNotFound;
    #[derive(Debug, pvm_contract_sdk::SolError)]
    pub struct ResponseNotFound;
    #[derive(Debug, pvm_contract_sdk::SolError)]
    pub struct AlreadyResponded;

    pub struct Surveys {
        #[slot(0)]
        survey_count: Lazy<u64>,
        #[slot(1)]
        survey_cids: Mapping<u64, String>,
        #[slot(2)]
        survey_creators: Mapping<u64, [u8; 20]>,
        #[slot(3)]
        response_counts: Mapping<u64, u64>,
        #[slot(4)]
        response_cids: Mapping<(u64, u64), String>,
        #[slot(5)]
        responded: Mapping<(u64, [u8; 20]), bool>,
    }

    impl Surveys {
        #[pvm_contract_sdk::constructor]
        pub fn new(&mut self) {
            self.survey_count.set(&0);
        }

        #[pvm_contract_sdk::method]
        pub fn create_survey(&mut self, cid: String) -> u64 {
            let caller = self.caller();
            let id = self.survey_count.get();

            self.survey_cids.insert(&id, &cid);
            self.survey_creators.insert(&id, &caller.0);
            self.response_counts.insert(&id, &0);
            self.survey_count.set(&(id + 1));

            id
        }

        #[pvm_contract_sdk::method]
        pub fn submit_response(&mut self, survey_id: u64, response_cid: String) -> Result<(), Error> {
            let caller = self.caller();

            if survey_id >= self.survey_count.get() {
                return Err(SurveyNotFound.into());
            }
            if self.responded.get(&(survey_id, caller.0)) {
                return Err(AlreadyResponded.into());
            }

            let idx = self.response_counts.get(&survey_id);
            self.response_cids.insert(&(survey_id, idx), &response_cid);
            self.response_counts.insert(&survey_id, &(idx + 1));
            self.responded.insert(&(survey_id, caller.0), &true);

            Ok(())
        }

        #[pvm_contract_sdk::method]
        pub fn get_survey_count(&self) -> u64 {
            self.survey_count.get()
        }

        #[pvm_contract_sdk::method]
        pub fn get_survey_cid(&self, survey_id: u64) -> Result<String, Error> {
            if survey_id >= self.survey_count.get() {
                return Err(SurveyNotFound.into());
            }
            Ok(self.survey_cids.get(&survey_id))
        }

        #[pvm_contract_sdk::method]
        pub fn get_survey_creator(&self, survey_id: u64) -> Result<Address, Error> {
            if survey_id >= self.survey_count.get() {
                return Err(SurveyNotFound.into());
            }
            Ok(Address(self.survey_creators.get(&survey_id)))
        }

        #[pvm_contract_sdk::method]
        pub fn get_response_count(&self, survey_id: u64) -> u64 {
            self.response_counts.get(&survey_id)
        }

        #[pvm_contract_sdk::method]
        pub fn get_response_cid(&self, survey_id: u64, index: u64) -> Result<String, Error> {
            if survey_id >= self.survey_count.get() || index >= self.response_counts.get(&survey_id) {
                return Err(ResponseNotFound.into());
            }
            Ok(self.response_cids.get(&(survey_id, index)))
        }

        #[pvm_contract_sdk::method]
        pub fn has_responded(&self, survey_id: u64, user: Address) -> bool {
            self.responded.get(&(survey_id, user.0))
        }

        fn caller(&self) -> Address {
            let mut buf = [0u8; 20];
            self.host().caller(&mut buf);
            Address(buf)
        }
    }
}
