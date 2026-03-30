#![no_main]
#![no_std]

use alloc::string::String;
use pvm::storage::Mapping;
use pvm_contract as pvm;

#[allow(unreachable_code)]
fn revert(msg: &[u8]) -> ! {
    pvm::api::return_value(pvm_contract::ReturnFlags::REVERT, msg);
    loop {}
}

#[pvm::storage]
struct Storage {
    survey_count: u64,
    survey_cids: Mapping<u64, String>,
    survey_creators: Mapping<u64, [u8; 20]>,
    response_counts: Mapping<u64, u64>,
    response_cids: Mapping<(u64, u64), String>,
    has_responded: Mapping<(u64, [u8; 20]), bool>,
}

#[pvm::contract(cdm = "@example/surveys")]
mod surveys {
    use super::*;

    #[pvm::constructor]
    pub fn new() -> Result<(), Error> {
        Storage::survey_count().set(&0);
        Ok(())
    }

    #[pvm::method]
    pub fn create_survey(cid: String) -> u64 {
        let caller = *pvm::caller().as_fixed_bytes();
        let id = Storage::survey_count().get().unwrap_or(0);

        Storage::survey_cids().insert(&id, &cid);
        Storage::survey_creators().insert(&id, &caller);
        Storage::response_counts().insert(&id, &0);
        Storage::survey_count().set(&(id + 1));

        id
    }

    #[pvm::method]
    pub fn submit_response(survey_id: u64, response_cid: String) {
        let caller = *pvm::caller().as_fixed_bytes();
        let count = Storage::survey_count().get().unwrap_or(0);

        if survey_id >= count {
            revert(b"SurveyNotFound");
        }

        if Storage::has_responded().get(&(survey_id, caller)).unwrap_or(false) {
            revert(b"AlreadyResponded");
        }

        let idx = Storage::response_counts().get(&survey_id).unwrap_or(0);
        Storage::response_cids().insert(&(survey_id, idx), &response_cid);
        Storage::response_counts().insert(&survey_id, &(idx + 1));
        Storage::has_responded().insert(&(survey_id, caller), &true);
    }

    #[pvm::method]
    pub fn get_survey_count() -> u64 {
        Storage::survey_count().get().unwrap_or(0)
    }

    #[pvm::method]
    pub fn get_survey_cid(survey_id: u64) -> String {
        match Storage::survey_cids().get(&survey_id) {
            Some(cid) => cid,
            None => revert(b"SurveyNotFound"),
        }
    }

    #[pvm::method]
    pub fn get_survey_creator(survey_id: u64) -> [u8; 20] {
        match Storage::survey_creators().get(&survey_id) {
            Some(addr) => addr,
            None => revert(b"SurveyNotFound"),
        }
    }

    #[pvm::method]
    pub fn get_response_count(survey_id: u64) -> u64 {
        Storage::response_counts().get(&survey_id).unwrap_or(0)
    }

    #[pvm::method]
    pub fn get_response_cid(survey_id: u64, index: u64) -> String {
        match Storage::response_cids().get(&(survey_id, index)) {
            Some(cid) => cid,
            None => revert(b"ResponseNotFound"),
        }
    }

    #[pvm::method]
    pub fn has_responded(survey_id: u64, user: [u8; 20]) -> bool {
        Storage::has_responded().get(&(survey_id, user)).unwrap_or(false)
    }
}
